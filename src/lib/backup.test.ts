import { describe, expect, it } from "vitest";
import {
  BACKUP_VERSION,
  backupFileSchema,
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
          transactions: [{ id: "t1", amount: 100 }],
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
        invoices: [{ id: "i1", customerId: "c1" }],
        payments: [{ id: "p1", invoiceId: "i1" }],
        transactions: [{ id: "t1", receiptIds: ["r1"] }],
        receipts: [{ id: "r1", transactionId: "t1" }],
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

  it("journalEntries.sourceIdとaiSuggestions.target.idを種別に応じて張り替える", () => {
    const backup = parse({
      ...BASE_BACKUP,
      collections: {
        transactions: [{ id: "t1" }],
        journalEntries: [
          { id: "j1", sourceType: "transaction", sourceId: "t1" },
          { id: "j2", sourceType: "manual", sourceId: "t1" },
        ],
        aiSuggestions: [
          { id: "s1", target: { type: "transaction", id: "t1" } },
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
    const suggestion = result.writes.find(
      (w) => w.collection === "aiSuggestions",
    )!;
    expect(suggestion.data.target).toEqual({
      type: "transaction",
      id: txWrite.id,
    });
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
    expect(result.counts.monthlySummaries).toEqual({ written: 1, skipped: 0 });
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
        transactions: [{ id: "t1" }],
        aiSuggestions: [
          {
            id: "s1",
            businessId: "biz-src",
            target: { type: "transaction", id: "t1" },
          },
        ],
        auditLogs: [
          {
            id: "a1",
            targetPath: "businesses/biz-src/transactions/t1",
          },
        ],
        closingChecks: [
          {
            id: "k1",
            fiscalPeriodId: "fy2025",
            targetPath: "businesses/biz-src/fiscalPeriods/fy2025",
          },
        ],
      },
    });
    const result = plan(
      backup,
      new Map([["transactions", new Set(["t1"])]]),
    );
    const txWrite = result.writes.find((w) => w.collection === "transactions")!;
    const suggestion = result.writes.find(
      (w) => w.collection === "aiSuggestions",
    )!;
    expect(suggestion.data.businessId).toBe("biz-dst");
    const audit = result.writes.find((w) => w.collection === "auditLogs")!;
    expect(audit.data.targetPath).toBe(
      `businesses/biz-dst/transactions/${txWrite.id}`,
    );
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
          { id: "t1", amount: 1 },
          { id: "t1", amount: 2 },
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
        transactions: [{ id: "t1" }],
      },
    });
    const result = plan(backup);
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0].collection).toBe("transactions");
  });
});
