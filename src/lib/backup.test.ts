import { describe, expect, it } from "vitest";
import {
  BACKUP_VERSION,
  backupFileSchema,
  backupFreshness,
  planRestore,
  summarizeBackup,
  type ParsedBackupFile,
} from "./backup";

const BASE_BACKUP: ParsedBackupFile = {
  version: BACKUP_VERSION,
  exportedAt: "2026-11-02T00:00:00.000Z",
  businessId: "biz-src",
  collections: {},
};

function parse(input: unknown): ParsedBackupFile {
  const result = backupFileSchema.safeParse(input);
  if (!result.success) throw new Error("fixture must be valid");
  return result.data;
}

function plan(
  backup: ParsedBackupFile,
  existingIds: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  opts: Partial<Parameters<typeof planRestore>[2]> = {},
) {
  let seq = 0;
  return planRestore(backup, existingIds, {
    targetBusinessId: "biz-dst",
    actorUid: "tester",
    newId: () => `new-${++seq}`,
    ...opts,
  });
}

describe("backupFileSchema", () => {
  it("有効なバックアップを受理し、ドキュメントの任意フィールドを保持する", () => {
    const result = backupFileSchema.safeParse({
      ...BASE_BACKUP,
      business: { name: "テスト事業", ownerUid: "u1" },
      collections: {
        transactions: [
          { id: "t1", type: "income", amount: 1000, nested: { a: [1] } },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const doc = result.data.collections.transactions[0];
      expect(doc.amount).toBe(1000);
      expect(doc.nested).toEqual({ a: [1] });
      // businessの許可外フィールド(ownerUid)はstripされる
      expect(result.data.business).toEqual({ name: "テスト事業" });
    }
  });

  it("未知のコレクションキーを受理する(前方互換)", () => {
    const result = backupFileSchema.safeParse({
      ...BASE_BACKUP,
      collections: { futureCollection: [{ id: "x" }] },
    });
    expect(result.success).toBe(true);
  });

  it("version不一致・businessId欠如・id欠落を拒否する", () => {
    expect(
      backupFileSchema.safeParse({ ...BASE_BACKUP, version: 2 }).success,
    ).toBe(false);
    expect(
      backupFileSchema.safeParse({ ...BASE_BACKUP, businessId: "" }).success,
    ).toBe(false);
    expect(
      backupFileSchema.safeParse({
        ...BASE_BACKUP,
        collections: { transactions: [{ amount: 1 }] },
      }).success,
    ).toBe(false);
    expect(
      backupFileSchema.safeParse({ ...BASE_BACKUP, collections: "x" }).success,
    ).toBe(false);
  });
});

describe("summarizeBackup", () => {
  it("コレクションごとの件数を返し、未知コレクションも列挙する", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        transactions: [{ id: "t1" }, { id: "t2" }],
        customers: [{ id: "c1" }],
        unknownCol: [{ id: "u1" }],
      },
    });
    const summary = summarizeBackup(backup);
    expect(summary.find((e) => e.name === "transactions")?.count).toBe(2);
    expect(summary.find((e) => e.name === "customers")?.count).toBe(1);
    expect(summary.find((e) => e.name === "receipts")?.count).toBe(0);
    expect(summary.find((e) => e.name === "unknownCol")?.count).toBe(1);
  });
});

describe("planRestore", () => {
  it("衝突がなければ元IDのまま全件書き込み対象になる", () => {
    const result = plan(
      parse({
        ...BASE_BACKUP,
        collections: {
          transactions: [{ id: "t1", amount: 100, status: "confirmed" }],
          customers: [{ id: "c1", name: "顧客" }],
        },
      }),
    );
    expect(result.writes).toHaveLength(2);
    expect(result.writes.map((w) => w.id)).toEqual(["c1", "t1"]);
    expect(result.remappedCount).toBe(0);
    expect(result.counts.transactions).toEqual({ written: 1, skipped: 0 });
    // データ内idは書き込み先IDと一致する(ドメインはdocデータ内にもidを持つ)
    for (const w of result.writes) {
      expect(w.data.id).toBe(w.id);
    }
  });

  it("ID衝突時は新規採番し、参照フィールドを張り替える", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        customers: [{ id: "c1" }],
        invoices: [{ id: "i1", customerId: "c1", status: "issued" }],
        payments: [{ id: "p1", invoiceId: "i1" }],
        transactions: [
          { id: "t1", receiptIds: ["r1"], status: "confirmed" },
        ],
        receipts: [
          {
            id: "r1",
            transactionId: "t1",
            status: "linked",
            storagePath: "receipts/biz-src/r1/f.png",
            mimeType: "image/png",
          },
        ],
        expenses: [{ id: "e1", transactionId: "t1", receiptId: "r1" }],
      },
    });
    const existing = new Map([
      ["customers", new Set(["c1"])],
      ["transactions", new Set(["t1"])],
      ["receipts", new Set(["r1"])],
    ]);
    const result = plan(backup, existing);
    expect(result.remappedCount).toBe(3);

    const byCollection = (name: string) =>
      result.writes.find((w) => w.collection === name)!;
    const customerId = byCollection("customers").id;
    const transactionId = byCollection("transactions").id;
    const receiptId = byCollection("receipts").id;
    expect(customerId).toBe("new-1");
    expect(transactionId).toBe("new-2");
    expect(receiptId).toBe("new-3");

    // 請求は衝突していないので元IDのまま、customerIdのみ張替
    expect(byCollection("invoices").id).toBe("i1");
    expect(byCollection("invoices").data.customerId).toBe(customerId);
    expect(byCollection("payments").data.invoiceId).toBe("i1");
    expect(byCollection("transactions").data.receiptIds).toEqual([receiptId]);
    expect(byCollection("receipts").data.transactionId).toBe(transactionId);
    expect(byCollection("expenses").data.transactionId).toBe(transactionId);
    expect(byCollection("expenses").data.receiptId).toBe(receiptId);
  });

  it("journalEntries.sourceIdを種別に応じて張り替える", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        transactions: [{ id: "t1", status: "confirmed" }],
        journalEntries: [
          {
            id: "j1",
            sourceType: "transaction",
            sourceId: "t1",
            status: "confirmed",
          },
          { id: "j2", sourceType: "manual", sourceId: "t1", status: "draft" },
        ],
      },
    });
    const result = plan(
      backup,
      new Map([["transactions", new Set(["t1"])]]),
    );
    const txWrite = result.writes.find((w) => w.collection === "transactions")!;
    const journals = result.writes.filter(
      (w) => w.collection === "journalEntries",
    );
    expect(journals[0].data.sourceId).toBe(txWrite.id);
    // manualは参照先なし → 張替なし
    expect(journals[1].data.sourceId).toBe("t1");
  });

  it("auditLogs/aiSuggestions/monthlySummariesは復元対象外になる(R2-2)", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        auditLogs: [
          { id: "a1", actorUid: "other", action: "close", targetPath: "x" },
        ],
        aiSuggestions: [
          { id: "s1", status: "accepted", decidedBy: "other" },
        ],
        monthlySummaries: [{ id: "202601", income: 1 }],
        transactions: [{ id: "t1", status: "confirmed" }],
      },
    });
    const result = plan(backup);
    expect(result.counts.auditLogs).toEqual({ written: 0, skipped: 1 });
    expect(result.counts.aiSuggestions).toEqual({ written: 0, skipped: 1 });
    expect(result.counts.monthlySummaries).toEqual({ written: 0, skipped: 1 });
    expect(
      result.writes.every(
        (w) =>
          w.collection !== "auditLogs" &&
          w.collection !== "aiSuggestions" &&
          w.collection !== "monthlySummaries",
      ),
    ).toBe(true);
  });

  it("固定IDコレクションは衝突時にskipし既存を維持する", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        members: [
          { id: "u1", role: "editor" },
          { id: "u2", role: "viewer" },
        ],
        fiscalPeriods: [{ id: "fy2025", status: "closed" }],
        monthlySummaries: [{ id: "202601" }],
      },
    });
    const result = plan(
      backup,
      new Map([
        ["members", new Set(["u1"])],
        ["fiscalPeriods", new Set(["fy2025"])],
      ]),
    );
    expect(result.counts.members).toEqual({ written: 1, skipped: 1 });
    expect(result.counts.fiscalPeriods).toEqual({ written: 0, skipped: 1 });
    // monthlySummariesは復元対象外(R2-2)
    expect(result.counts.monthlySummaries).toEqual({ written: 0, skipped: 1 });
    // 衝突した固定IDは再採番されない(remap対象外)
    expect(result.remappedCount).toBe(0);
    const member = result.writes.find((w) => w.collection === "members")!;
    expect(member.id).toBe("u2");
  });

  it("protectedUidsのmemberドキュメントは存在しなくてもskipする", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        members: [
          { id: "owner-uid", role: "viewer" },
          { id: "other", role: "editor" },
        ],
      },
    });
    const result = plan(backup, new Map(), {
      protectedUids: ["owner-uid"],
    });
    expect(result.counts.members).toEqual({ written: 1, skipped: 1 });
    expect(result.writes[0].id).toBe("other");
  });

  it("businessIdフィールドとtargetPathを復元先へ書き換える", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        transactions: [
          { id: "t1", status: "confirmed", businessId: "biz-src" },
        ],
        closingChecks: [
          {
            id: "k1",
            fiscalPeriodId: "fy2025",
            status: "open",
            targetPath: "businesses/biz-src/fiscalPeriods/fy2025",
          },
        ],
      },
    });
    const result = plan(backup);
    const txWrite = result.writes.find((w) => w.collection === "transactions")!;
    expect(txWrite.data.businessId).toBe("biz-dst");
    const check = result.writes.find((w) => w.collection === "closingChecks")!;
    // fiscalPeriodsは固定ID(衝突していない)なのでIDはそのまま、businessIdのみ張替
    expect(check.data.targetPath).toBe(
      "businesses/biz-dst/fiscalPeriods/fy2025",
    );
  });

  it("ファイル内の重複IDは2件目を新規採番する", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        transactions: [
          { id: "t1", amount: 1, status: "draft" },
          { id: "t1", amount: 2, status: "draft" },
        ],
      },
    });
    const result = plan(backup);
    expect(result.writes.map((w) => w.id)).toEqual(["t1", "new-1"]);
    expect(result.remappedCount).toBe(1);
  });

  it("未知のコレクションは書き込み対象にしない", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        unknownCol: [{ id: "x" }],
        transactions: [{ id: "t1", status: "draft" }],
      },
    });
    const result = plan(backup);
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0].collection).toBe("transactions");
  });
});

describe("backupFreshness", () => {
  const NOW = new Date("2026-11-02T00:00:00.000Z").getTime();

  it("未取得(undefined)は never", () => {
    expect(backupFreshness(undefined, NOW)).toBe("never");
  });

  it("不正な日付文字列は安全側で never", () => {
    expect(backupFreshness("not-a-date", NOW)).toBe("never");
  });

  it("30日以内は fresh、30日超過は stale", () => {
    expect(
      backupFreshness("2026-10-10T00:00:00.000Z", NOW),
    ).toBe("fresh");
    expect(
      backupFreshness("2026-10-03T00:00:00.000Z", NOW),
    ).toBe("fresh");
    expect(
      backupFreshness("2026-10-02T00:00:00.000Z", NOW),
    ).toBe("stale");
    expect(
      backupFreshness("2026-01-01T00:00:00.000Z", NOW),
    ).toBe("stale");
  });
});

describe("sanitizeRestoredDoc (planRestore経由, R2-2)", () => {
  it("status='locked'はconfirmedへ正規化し、enum外statusのdocはskipする", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        transactions: [
          { id: "t1", status: "locked" },
          { id: "t2", status: "deleted" },
          { id: "t3", status: "confirmed" },
        ],
        journalEntries: [{ id: "j1", status: "locked" }],
      },
    });
    const result = plan(backup);
    const txs = result.writes.filter((w) => w.collection === "transactions");
    expect(txs.map((w) => w.id)).toEqual(["t1", "t3"]);
    expect(txs[0].data.status).toBe("confirmed");
    expect(
      result.writes.find((w) => w.collection === "journalEntries")?.data
        .status,
    ).toBe("confirmed");
  });

  it("帰属フィールドを復元実行者へ上書きし、Admin専用フィールドを除去する", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        transactions: [
          { id: "t1", status: "confirmed", createdBy: "other" },
        ],
        closingChecks: [
          { id: "k1", status: "resolved", resolvedBy: "other" },
        ],
        journalEntries: [
          { id: "j1", status: "draft", aiSuggestionId: "s1" },
        ],
      },
    });
    const result = plan(backup);
    const tx = result.writes.find((w) => w.collection === "transactions")!;
    expect(tx.data.createdBy).toBe("tester");
    const check = result.writes.find(
      (w) => w.collection === "closingChecks",
    )!;
    expect(check.data.resolvedBy).toBe("tester");
    const journal = result.writes.find(
      (w) => w.collection === "journalEntries",
    )!;
    expect("aiSuggestionId" in journal.data).toBe(false);
  });

  it("既存closed期間内の日付を持つdocはskipする", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        transactions: [
          { id: "t1", status: "confirmed", date: "2025-05-10" },
          { id: "t2", status: "confirmed", date: "2026-05-10" },
        ],
        payments: [{ id: "p1", date: "2025-12-31", amount: 1 }],
      },
    });
    const result = plan(backup, new Map(), {
      closedRanges: [{ startDate: "2025-01-01", endDate: "2025-12-31" }],
    });
    const txs = result.writes.filter((w) => w.collection === "transactions");
    expect(txs.map((w) => w.id)).toEqual(["t2"]);
    expect(result.counts.payments).toEqual({ written: 0, skipped: 1 });
  });

  it("members: ownerロール注入をskipし、uid/invitedByを正規化する", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        members: [
          { id: "u1", role: "owner", invitedBy: "other" },
          { id: "u2", role: "editor", uid: "spoofed", invitedBy: "other" },
        ],
      },
    });
    const result = plan(backup);
    const members = result.writes.filter((w) => w.collection === "members");
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe("u2");
    expect(members[0].data.uid).toBe("u2");
    expect(members[0].data.invitedBy).toBe("tester");
  });

  it("receipts: storagePath接頭辞・mimeTypeが不正なdocはskipする", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        receipts: [
          {
            id: "r1",
            status: "unprocessed",
            storagePath: "secrets/other/x.pdf",
            mimeType: "application/pdf",
          },
          {
            id: "r2",
            status: "unprocessed",
            storagePath: "receipts/biz-src/r2/f.html",
            mimeType: "text/html",
          },
          {
            id: "r3",
            status: "unprocessed",
            storagePath: "receipts/biz-src/r3/f.png",
            mimeType: "image/png",
          },
        ],
      },
    });
    const result = plan(backup);
    const receipts = result.writes.filter((w) => w.collection === "receipts");
    expect(receipts.map((w) => w.id)).toEqual(["r3"]);
  });
});
