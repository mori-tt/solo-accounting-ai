import { serializeCsv } from "./csv";

/**
 * 監査ログ閲覧画面の表示・絞り込みロジック(純粋関数)。
 * auditLogs は対象の識別情報(actorUid / action / targetPath / createdAt)のみを持ち、
 * 内容スナップショットは保存しない(docs/SECURITY_RULES.md)。
 * そのため概要列は targetPath と action から導出した説明文を表示する。
 */

export interface AuditTargetRef {
  /** targetPath のコレクション部。事業ドキュメント自体は "businesses" */
  collection: string;
  /**
   * 対象ドキュメントID(事業ドキュメント自体は businessId)。
   * ネストしたパスでは先頭サブコレクション配下の残りをまとめて保持する。
   */
  docId: string;
}

/**
 * `businesses/{businessId}/{collection}/{docId}` 形式の targetPath を分解する。
 * 事業ルート `businesses/{businessId}` は collection="businesses" として扱う。
 * 解釈できない形式は undefined。
 */
export function parseAuditTargetPath(
  targetPath: string,
): AuditTargetRef | undefined {
  const segments = targetPath.split("/").filter((s) => s !== "");
  if (segments[0] !== "businesses") return undefined;
  if (segments.length === 2) {
    return { collection: "businesses", docId: segments[1] };
  }
  if (segments.length >= 4) {
    return { collection: segments[2], docId: segments.slice(3).join("/") };
  }
  return undefined;
}

/** 対象種別の表示名。配列の並びがフィルタの選択肢順になる */
export const AUDIT_TARGET_TYPES = [
  { value: "transactions", label: "取引" },
  { value: "expenses", label: "経費" },
  { value: "receipts", label: "領収書" },
  { value: "invoices", label: "請求書" },
  { value: "payments", label: "入金" },
  { value: "customers", label: "顧客" },
  { value: "projects", label: "案件" },
  { value: "journalEntries", label: "仕訳" },
  { value: "fiscalPeriods", label: "会計期間" },
  { value: "closingChecks", label: "締めチェック" },
  { value: "monthlySummaries", label: "月次集計" },
  { value: "aiSuggestions", label: "AI提案" },
  { value: "members", label: "メンバー" },
  { value: "businesses", label: "事業" },
  { value: "idempotencyKeys", label: "冪等キー" },
  { value: "imports", label: "インポート" },
] as const;

const targetTypeLabelMap: ReadonlyMap<string, string> = new Map(
  AUDIT_TARGET_TYPES.map((t) => [t.value, t.label]),
);

/** 対象種別 → 表示名。未定義はそのまま返す */
export function auditTargetTypeLabel(collection: string): string {
  return targetTypeLabelMap.get(collection) ?? collection;
}

export const AUDIT_ACTIONS = [
  { value: "create", label: "登録" },
  { value: "update", label: "更新" },
  { value: "delete", label: "削除" },
  { value: "close", label: "締め" },
  { value: "run_ai", label: "AI実行" },
  { value: "approve_ai", label: "AI提案承認" },
  { value: "reject_ai", label: "AI提案却下" },
  { value: "import", label: "インポート" },
] as const;

const actionLabelMap: ReadonlyMap<string, string> = new Map(
  AUDIT_ACTIONS.map((a) => [a.value, a.label]),
);

/** 操作 → 表示名。未定義はそのまま返す */
export function auditActionLabel(action: string): string {
  return actionLabelMap.get(action) ?? action;
}

/** CSVインポートの種別。監査の targetPath は `imports/{kind}:{件数}` 形式の擬似パス */
export const IMPORT_KINDS = [
  { value: "bank-csv", label: "明細CSV" },
  { value: "transactions-csv", label: "取引CSV" },
] as const;

export type ImportKind = (typeof IMPORT_KINDS)[number]["value"];

const importKindLabelMap: ReadonlyMap<string, string> = new Map(
  IMPORT_KINDS.map((k) => [k.value, k.label]),
);

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === "string" && importKindLabelMap.has(value);
}

/** `imports` 対象の docId(`{kind}:{件数}`)を分解する。解釈不可は undefined */
export function parseImportDocId(
  docId: string,
): { kind: ImportKind; count: number | null } | undefined {
  const m = /^([a-z-]+)(?::(\d+))?$/.exec(docId);
  if (!m || !isImportKind(m[1])) return undefined;
  return { kind: m[1], count: m[2] === undefined ? null : Number(m[2]) };
}

/** AI系actionは対象を含む説明文を持つため概要はそれをそのまま使う */
const SELF_DESCRIBING_ACTIONS: Record<string, string> = {
  run_ai: "AI提案を実行",
  approve_ai: "AI提案を承認",
  reject_ai: "AI提案を却下",
};

/** インポート実行の概要。targetPath の docId から種別・件数を取り出す */
function describeImportEntry(targetPath: string): string {
  const target = parseAuditTargetPath(targetPath);
  const info =
    target?.collection === "imports"
      ? parseImportDocId(target.docId)
      : undefined;
  if (!info) return "インポートを実行";
  const kindLabel = importKindLabelMap.get(info.kind) ?? info.kind;
  return info.count === null
    ? `${kindLabel}をインポート`
    : `${kindLabel}から${info.count}件を取込`;
}

/**
 * 操作の概要。「対象ラベル + 操作」の説明文を組み立てる
 * (スナップショットは保存されていないため差分の内容自体は表示できない)。
 */
export function describeAuditEntry(entry: {
  action: string;
  targetPath: string;
}): string {
  const self = SELF_DESCRIBING_ACTIONS[entry.action];
  if (self) return self;
  if (entry.action === "import") return describeImportEntry(entry.targetPath);
  const target = parseAuditTargetPath(entry.targetPath);
  const label = target ? auditTargetTypeLabel(target.collection) : "対象";
  return `${label}を${auditActionLabel(entry.action)}`;
}

export interface AuditLogFilter {
  /** action の完全一致。未指定は全件 */
  action?: string;
  /** targetPath のコレクション部の完全一致。未指定は全件 */
  targetType?: string;
  /** createdAt の下限(ISO 8601・この時点を含む) */
  startAt?: string;
  /** createdAt の上限(ISO 8601・この時点を含む) */
  endAt?: string;
}

export interface AuditLogViewEntry {
  id: string;
  action: string;
  targetPath: string;
  /** ISO 8601 */
  createdAt: string;
}

/**
 * 絞り込み + createdAt 降順(同時刻は id 降順で安定化)に並べ替える。
 * startAt/endAt と createdAt はいずれも ISO 8601 で、
 * 文字列比較が時系列順と一致することを利用する。
 */
export function filterAuditLogs<T extends AuditLogViewEntry>(
  entries: readonly T[],
  filter: AuditLogFilter = {},
): T[] {
  return entries
    .filter((e) => {
      if (filter.action && e.action !== filter.action) return false;
      if (filter.targetType) {
        const target = parseAuditTargetPath(e.targetPath);
        if (target?.collection !== filter.targetType) return false;
      }
      if (filter.startAt && e.createdAt < filter.startAt) return false;
      if (filter.endAt && e.createdAt > filter.endAt) return false;
      return true;
    })
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
}

// ---------- CSV エクスポート ----------

/**
 * 監査ログCSVの列。電帳法の訂正削除履歴確認・税務調査の
 * 「ダウンロードの求め」への対応として、画面表示と同じ絞り込み結果を
 * 識別情報つきで出力する。日時はソート可能なISO 8601のまま出す。
 */
export const AUDIT_LOG_CSV_HEADER = [
  "日時",
  "ユーザー",
  "actorUid",
  "操作",
  "対象種別",
  "対象",
  "概要",
] as const;

export interface AuditLogCsvEntry extends AuditLogViewEntry {
  actorUid: string;
  /** メンバーの表示名またはメールアドレス。未解決は null */
  actorName: string | null;
}

/** 監査ログ一覧 → ヘッダー付きCSV文字列(BOMなし)。絞り込み済みの列を渡す */
export function buildAuditLogCsv(
  entries: readonly AuditLogCsvEntry[],
): string {
  return serializeCsv([
    [...AUDIT_LOG_CSV_HEADER],
    ...entries.map((e) => {
      const target = parseAuditTargetPath(e.targetPath);
      return [
        e.createdAt,
        e.actorName ?? "",
        e.actorUid,
        auditActionLabel(e.action),
        target ? auditTargetTypeLabel(target.collection) : "",
        e.targetPath,
        describeAuditEntry(e),
      ];
    }),
  ]);
}
