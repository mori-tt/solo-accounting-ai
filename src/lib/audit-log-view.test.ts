import { describe, expect, it } from "vitest";
import {
  AUDIT_LOG_CSV_HEADER,
  auditActionLabel,
  auditTargetTypeLabel,
  buildAuditLogCsv,
  describeAuditEntry,
  filterAuditLogs,
  isImportKind,
  parseAuditTargetPath,
  parseImportDocId,
  type AuditLogCsvEntry,
  type AuditLogViewEntry,
} from "./audit-log-view";

describe("parseAuditTargetPath", () => {
  it("サブコレクションのドキュメントを分解する", () => {
    expect(
      parseAuditTargetPath("businesses/b1/transactions/t1"),
    ).toEqual({ collection: "transactions", docId: "t1" });
    expect(
      parseAuditTargetPath("businesses/b1/members/u9"),
    ).toEqual({ collection: "members", docId: "u9" });
  });

  it("事業ドキュメント自体は businesses として扱う", () => {
    expect(parseAuditTargetPath("businesses/b1")).toEqual({
      collection: "businesses",
      docId: "b1",
    });
  });

  it("ネストしたパスは先頭サブコレクション+残りのパスを保持する", () => {
    expect(
      parseAuditTargetPath("businesses/b1/transactions/t1/lines/l9"),
    ).toEqual({ collection: "transactions", docId: "t1/lines/l9" });
  });

  it("解釈できない形式は undefined", () => {
    expect(parseAuditTargetPath("")).toBeUndefined();
    expect(parseAuditTargetPath("other/b1/transactions/t1")).toBeUndefined();
    expect(parseAuditTargetPath("businesses")).toBeUndefined();
    expect(parseAuditTargetPath("businesses/b1/incomplete")).toBeUndefined();
  });
});

describe("ラベル", () => {
  it("対象種別は日本語ラベル、未定義はそのまま", () => {
    expect(auditTargetTypeLabel("transactions")).toBe("取引");
    expect(auditTargetTypeLabel("fiscalPeriods")).toBe("会計期間");
    expect(auditTargetTypeLabel("unknownCol")).toBe("unknownCol");
  });

  it("操作は日本語ラベル、未定義はそのまま", () => {
    expect(auditActionLabel("create")).toBe("登録");
    expect(auditActionLabel("close")).toBe("締め");
    expect(auditActionLabel("custom_action")).toBe("custom_action");
  });
});

describe("describeAuditEntry", () => {
  it("対象ラベル+操作の説明文を返す", () => {
    expect(
      describeAuditEntry({
        action: "update",
        targetPath: "businesses/b1/transactions/t1",
      }),
    ).toBe("取引を更新");
    expect(
      describeAuditEntry({
        action: "create",
        targetPath: "businesses/b1/customers/c1",
      }),
    ).toBe("顧客を登録");
    expect(
      describeAuditEntry({
        action: "close",
        targetPath: "businesses/b1/fiscalPeriods/fy2025",
      }),
    ).toBe("会計期間を締め");
    expect(
      describeAuditEntry({
        action: "delete",
        targetPath: "businesses/b1/members/u1",
      }),
    ).toBe("メンバーを削除");
  });

  it("AI系actionは対象を含む説明文をそのまま使う", () => {
    expect(
      describeAuditEntry({
        action: "run_ai",
        targetPath: "businesses/b1/aiSuggestions/s1",
      }),
    ).toBe("AI提案を実行");
    expect(
      describeAuditEntry({
        action: "approve_ai",
        targetPath: "businesses/b1/aiSuggestions/s1",
      }),
    ).toBe("AI提案を承認");
    expect(
      describeAuditEntry({
        action: "reject_ai",
        targetPath: "businesses/b1/aiSuggestions/s1",
      }),
    ).toBe("AI提案を却下");
  });

  it("解釈できないtargetPathでもクラッシュしない", () => {
    expect(
      describeAuditEntry({ action: "update", targetPath: "broken" }),
    ).toBe("対象を更新");
  });

  it("インポートは種別+件数を含む説明文を返す", () => {
    expect(
      describeAuditEntry({
        action: "import",
        targetPath: "businesses/b1/imports/bank-csv:12",
      }),
    ).toBe("明細CSVから12件を取込");
    expect(
      describeAuditEntry({
        action: "import",
        targetPath: "businesses/b1/imports/transactions-csv:3",
      }),
    ).toBe("取引CSVから3件を取込");
    expect(
      describeAuditEntry({
        action: "import",
        targetPath: "businesses/b1/imports/bank-csv",
      }),
    ).toBe("明細CSVをインポート");
    expect(
      describeAuditEntry({
        action: "import",
        targetPath: "businesses/b1/imports/unknown:5",
      }),
    ).toBe("インポートを実行");
  });
});

describe("parseImportDocId", () => {
  it("kind:件数 形式を分解する", () => {
    expect(parseImportDocId("bank-csv:12")).toEqual({
      kind: "bank-csv",
      count: 12,
    });
    expect(parseImportDocId("transactions-csv")).toEqual({
      kind: "transactions-csv",
      count: null,
    });
  });

  it("未定義のkind・不正形式は undefined", () => {
    expect(parseImportDocId("other:5")).toBeUndefined();
    expect(parseImportDocId("bank-csv:abc")).toBeUndefined();
    expect(parseImportDocId("")).toBeUndefined();
  });

  it("isImportKind は定義済み種別のみ true", () => {
    expect(isImportKind("bank-csv")).toBe(true);
    expect(isImportKind("transactions-csv")).toBe(true);
    expect(isImportKind("other")).toBe(false);
    expect(isImportKind(12)).toBe(false);
    expect(isImportKind(undefined)).toBe(false);
  });
});

const entry = (
  id: string,
  createdAt: string,
  action = "update",
  targetPath = "businesses/b1/transactions/t1",
): AuditLogViewEntry => ({ id, createdAt, action, targetPath });

describe("filterAuditLogs", () => {
  const logs: AuditLogViewEntry[] = [
    entry("a1", "2026-10-01T01:00:00.000Z", "create"),
    entry("a2", "2026-10-03T01:00:00.000Z", "update"),
    entry("a3", "2026-10-02T01:00:00.000Z", "delete", "businesses/b1/receipts/r1"),
    entry("a4", "2026-10-03T01:00:00.000Z", "run_ai", "businesses/b1/aiSuggestions/s1"),
  ];

  it("createdAt降順に並ぶ。同時刻はid降順", () => {
    const result = filterAuditLogs(logs);
    expect(result.map((l) => l.id)).toEqual(["a4", "a2", "a3", "a1"]);
  });

  it("actionで絞り込める", () => {
    expect(
      filterAuditLogs(logs, { action: "update" }).map((l) => l.id),
    ).toEqual(["a2"]);
  });

  it("targetTypeはtargetPathのコレクション部で絞り込む", () => {
    expect(
      filterAuditLogs(logs, { targetType: "receipts" }).map((l) => l.id),
    ).toEqual(["a3"]);
    expect(
      filterAuditLogs(logs, { targetType: "aiSuggestions" }).map((l) => l.id),
    ).toEqual(["a4"]);
    expect(
      filterAuditLogs(logs, { targetType: "invoices" }),
    ).toEqual([]);
    expect(
      filterAuditLogs(
        [...logs, entry("a5", "2026-10-04T01:00:00.000Z", "import", "businesses/b1/imports/bank-csv:12")],
        { targetType: "imports" },
      ).map((l) => l.id),
    ).toEqual(["a5"]);
  });

  it("期間は両端を含む", () => {
    expect(
      filterAuditLogs(logs, {
        startAt: "2026-10-02T00:00:00.000Z",
        endAt: "2026-10-03T01:00:00.000Z",
      }).map((l) => l.id),
    ).toEqual(["a4", "a2", "a3"]);
  });

  it("条件を組み合わせられる", () => {
    expect(
      filterAuditLogs(logs, {
        action: "update",
        targetType: "transactions",
        startAt: "2026-10-02T00:00:00.000Z",
      }).map((l) => l.id),
    ).toEqual(["a2"]);
    expect(
      filterAuditLogs(logs, {
        action: "update",
        endAt: "2026-10-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });
});

describe("buildAuditLogCsv", () => {
  const csvEntry = (
    id: string,
    createdAt: string,
    extra: Partial<AuditLogCsvEntry> = {},
  ): AuditLogCsvEntry => ({
    id,
    createdAt,
    actorUid: "uid-" + id,
    actorName: null,
    action: "update",
    targetPath: "businesses/b1/transactions/t1",
    ...extra,
  });

  it("ヘッダー+行を定義列で出力する", () => {
    const csv = buildAuditLogCsv([
      csvEntry("a1", "2026-10-01T01:00:00.000Z", {
        actorName: "山田",
        action: "create",
      }),
      csvEntry("a2", "2026-10-02T01:00:00.000Z", {
        action: "delete",
        targetPath: "businesses/b1/receipts/r1",
      }),
    ]);
    const [header, r1, r2] = csv.split("\r\n");
    expect(header).toBe(AUDIT_LOG_CSV_HEADER.join(","));
    expect(r1).toBe(
      "2026-10-01T01:00:00.000Z,山田,uid-a1,登録,取引,businesses/b1/transactions/t1,取引を登録",
    );
    expect(r2).toBe(
      "2026-10-02T01:00:00.000Z,,uid-a2,削除,領収書,businesses/b1/receipts/r1,領収書を削除",
    );
  });

  it("解釈できないtargetPathは対象種別を空にする", () => {
    const csv = buildAuditLogCsv([
      csvEntry("a1", "2026-10-01T01:00:00.000Z", { targetPath: "broken" }),
    ]);
    const r1 = csv.split("\r\n")[1];
    expect(r1).toBe(
      "2026-10-01T01:00:00.000Z,,uid-a1,更新,,broken,対象を更新",
    );
  });
});
