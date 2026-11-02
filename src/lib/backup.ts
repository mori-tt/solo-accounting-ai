import { z } from "zod";
import type { Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/result";
import { isAllowedReceiptMime } from "@/lib/receipt-files";

/**
 * 事業データのJSONバックアップ/復元。
 *
 * - エクスポート: businesses/{businessId} とそのサブコレクション全件を
 *   1つのJSON(BACKUP_VERSION付き)にまとめる。Storageのファイル本体は含めず
 *   receiptsのメタデータ(storagePath等)のみを出力する。
 * - 復元: 別businessIdへのインポートを許容し、ドキュメントIDが衝突した場合は
 *   新規採番して参照フィールド(customerId等)を張り替える。
 *
 * このモジュールはクライアント(バックアップ画面のzod検証)からも
 * インポートされるため、firebase-adminの値importは持たない。
 * Firestore実処理は db 引数(Admin SDK)経由でサーバーサイドからのみ呼ぶこと。
 */

export const BACKUP_VERSION = 1;

/**
 * バックアップ対象の businesses/{businessId} 配下コレクション。
 * firestore.rules / docs/FIRESTORE_SCHEMA.md の実在コレクションに合わせる。
 * `idempotencyKeys` は内部機構(二重登録防止)のため対象外。
 * `users` は businessId スコープ外(個人情報)のため対象外。
 */
export const BACKUP_COLLECTIONS = [
  "members",
  "customers",
  "projects",
  "transactions",
  "expenses",
  "withholdingRecords",
  "receipts",
  "invoices",
  "quotes",
  "payments",
  "bills",
  "billPayments",
  "journalEntries",
  "fiscalPeriods",
  "closingChecks",
  "recurringTemplates",
  "recurringInvoiceTemplates",
  "fixedAssets",
  "aiSuggestions",
  "monthlySummaries",
  "auditLogs",
  "inventoryItems",
  "inventoryCounts",
] as const;

export type BackupCollection = (typeof BACKUP_COLLECTIONS)[number];

/** バックアップ鮮度アラートを出す閾値(日数) */
export const BACKUP_STALE_DAYS = 30;

export type BackupFreshness = "never" | "stale" | "fresh";

/**
 * 最終バックアップ日時から鮮度を判定する。
 * never=未取得・不正な日付(安全側)、stale=30日超過、fresh=30日以内。
 */
export function backupFreshness(
  lastBackupAt: string | undefined,
  now: number = Date.now(),
): BackupFreshness {
  if (!lastBackupAt) return "never";
  const t = new Date(lastBackupAt).getTime();
  if (!Number.isFinite(t)) return "never";
  return now - t > BACKUP_STALE_DAYS * 24 * 60 * 60 * 1000
    ? "stale"
    : "fresh";
}

/**
 * ドキュメントID自体が意味を持つコレクション
 * (members=uid / fiscalPeriods=fy{year} / monthlySummaries=yyyyMM)。
 * ID衝突時に新規採番すると意味が壊れるため、衝突時は既存を維持してskipする。
 */
const FIXED_ID_COLLECTIONS: ReadonlySet<string> = new Set([
  "members",
  "fiscalPeriods",
  "monthlySummaries",
  // fy{fiscalYear}の決定的ID(fiscalPeriodsと同じ採番)
  "inventoryCounts",
]);

export interface BackupDoc {
  id: string;
  [key: string]: unknown;
}

export interface BackupFile {
  version: number;
  exportedAt: string;
  /** エクスポート元のbusinessId(復元先とは別になりうる) */
  businessId: string;
  /** businessドキュメント。復元時はname/fiscalYearStartMonth/taxModeのみ適用 */
  business?: Record<string, unknown>;
  collections: Record<string, BackupDoc[]>;
}

const backupDocSchema = z.looseObject({
  id: z.string().min(1),
});

/**
 * businessドキュメントのうち復元を許可するフィールド。
 * .partial()により全て省略可。ownerUid等の指定外キーは
 * z.objectの既定(strip)で落ちるため、復元時に上書きされない。
 */
const backupBusinessSchema = z
  .object({
    name: z.string().min(1).max(100),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    taxMode: z.enum(["exempt", "simple", "standard", "special20"]),
  })
  .partial();

/** バックアップJSONの構造検証。未知のコレクションキーは保持する(前方互換) */
export const backupFileSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  businessId: z.string().min(1),
  business: backupBusinessSchema.optional(),
  collections: z.record(z.string(), z.array(backupDocSchema)),
});

export type ParsedBackupFile = z.infer<typeof backupFileSchema>;

/**
 * Firestoreの値をJSON化する。Timestamp等(toDate()を持つ値)は
 * ISO 8601文字列へ変換する。undefinedはキーごと除去する。
 */
function toJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return ((value as { toDate: () => Date }).toDate()).toISOString();
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = toJsonValue(v);
    }
    return out;
  }
  return value;
}

/**
 * 復元時の逆変換。store層(toStore)と同じ規約で `*At` フィールドの
 * ISO日時文字列を Date へ戻す(Admin SDKがTimestampとして保存する)。
 * paidAt 等の YYYY-MM-DD 文字列(日付のみ)はDate化しないよう、
 * 時刻部("T")を持つISO文字列のみを対象にする。
 */
function fromJsonDoc(data: Record<string, unknown>): Record<string, unknown> {
  const convert = (key: string | undefined, value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => convert(undefined, item));
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = convert(k, v);
      return out;
    }
    if (
      key?.endsWith("At") &&
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T/.test(value)
    ) {
      const ms = Date.parse(value);
      if (!Number.isNaN(ms)) return new Date(ms);
    }
    return value;
  };
  return convert(undefined, data) as Record<string, unknown>;
}

/** 事業の全データをバックアップJSONとして組み立てる。呼び出し側で認可済みのこと */
export async function exportBusinessBackup(
  db: Firestore,
  businessId: string,
): Promise<BackupFile> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) {
    throw new ApiError("NOT_FOUND", "事業が見つかりません");
  }

  const collections: Record<string, BackupDoc[]> = {};
  for (const name of BACKUP_COLLECTIONS) {
    const snap = await businessRef.collection(name).get();
    collections[name] = snap.docs.map((doc) => ({
      ...(toJsonValue(doc.data()) as Record<string, unknown>),
      // ドキュメントIDを正とする(データ内のidフィールドは冗長なので上書き)
      id: doc.id,
    }));
  }

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    businessId,
    business: toJsonValue(businessSnap.data() ?? {}) as Record<string, unknown>,
    collections,
  };
}

/** プレビュー用: コレクションごとのドキュメント件数 */
export function summarizeBackup(
  backup: ParsedBackupFile,
): { name: string; count: number }[] {
  const entries: { name: string; count: number }[] = BACKUP_COLLECTIONS.map(
    (name) => ({
      name,
      count: backup.collections[name]?.length ?? 0,
    }),
  );
  for (const [name, docs] of Object.entries(backup.collections)) {
    if (!(BACKUP_COLLECTIONS as readonly string[]).includes(name)) {
      entries.push({ name, count: docs.length });
    }
  }
  return entries;
}

// ---------- 復元 ----------

/**
 * 復元で書き戻さないコレクション(R2-2)。
 * - auditLogs: 任意actorUid/action/createdAtの偽造ログ注入を防ぐ(append-only の信頼根拠)
 * - aiSuggestions: 生成・内容確定はAdmin SDKの管轄。status/decidedByの偽造を防ぐ
 * - monthlySummaries: Cloud Functionsが再計算する派生データ(クライアント書込み不可と同義)
 */
const NON_RESTORABLE_COLLECTIONS: ReadonlySet<string> = new Set([
  "auditLogs",
  "aiSuggestions",
  "monthlySummaries",
]);

/**
 * 復元ドキュメントの status 検証(firestore.rules と同じenum)。
 * 'locked' は締め処理でのみ付与される値のため 'confirmed' へ正規化する
 * (復元で全経路変更不可の不正docを作らない)。
 * optional: アプリが status を持たないコレクション(expenses)は欠落を許容。
 */
const RESTORE_STATUS_RULES: Record<
  string,
  { allowed: readonly string[]; optional?: boolean } | undefined
> = {
  transactions: { allowed: ["draft", "confirmed"] },
  expenses: { allowed: ["draft", "confirmed"], optional: true },
  receipts: { allowed: ["unprocessed", "linked", "archived"] },
  invoices: { allowed: ["draft", "issued", "paid", "overdue"] },
  quotes: { allowed: ["draft", "sent", "accepted", "converted"] },

  bills: { allowed: ["unpaid", "paid"] },
  journalEntries: { allowed: ["draft", "confirmed"] },
  closingChecks: { allowed: ["open", "resolved", "waived"] },
  fiscalPeriods: { allowed: ["open", "closed"] },
  fixedAssets: { allowed: ["active", "disposed"] },
};

/**
 * 復元実行者のuidへ上書きする帰属フィールド。
 * 他人名義の作成/締め/解決を偽装されないよう、復元者を正当な帰属先とする。
 */
const RESTORE_ACTOR_FIELDS: Record<string, readonly string[] | undefined> = {
  transactions: ["createdBy"],
  expenses: ["createdBy"],
  withholdingRecords: ["createdBy"],
  receipts: ["createdBy"],
  journalEntries: ["createdBy"],
  recurringTemplates: ["createdBy"],
  recurringInvoiceTemplates: ["createdBy"],
  fixedAssets: ["createdBy"],
  closingChecks: ["createdBy", "resolvedBy"],
  fiscalPeriods: ["closedBy"],
  bills: ["createdBy"],

  inventoryItems: ["createdBy"],
  inventoryCounts: ["createdBy"],
};

/** Admin SDK専用フィールド。クライアント書き込み禁止と同じ扱いで復元時に除去 */
const ADMIN_ONLY_FIELDS = ["aiSuggestion", "aiSuggestionId"] as const;

/** closed期間への混入を検査する日付フィールド(YYYY-MM-DD) */
const RESTORE_DATE_FIELDS: Record<string, readonly string[] | undefined> = {
  transactions: ["date"],
  expenses: ["date"],
  payments: ["date"],
  journalEntries: ["date"],
  invoices: ["issueDate", "dueDate"],
  quotes: ["issueDate", "validUntil"],

  bills: ["receivedDate"],
  billPayments: ["date"],
};

/** 日付文字列がいずれかのclosed期間内か */
function inClosedRange(
  value: unknown,
  ranges: readonly { startDate: string; endDate: string }[],
): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return ranges.some((r) => value >= r.startDate && value <= r.endDate);
}

/**
 * 復元ドキュメントの sanitize(R2-2)。
 * 帰属フィールドの復元者化・status正規化・Admin専用フィールド除去・
 * closed期間混入のskip・membersのロール制限を行う。
 * null を返したdocは書き込まない。
 */
function sanitizeRestoredDoc(
  collection: string,
  data: Record<string, unknown>,
  targetId: string,
  ctx: {
    actorUid: string;
    targetBusinessId: string;
    closedRanges: readonly { startDate: string; endDate: string }[];
  },
): Record<string, unknown> | null {
  const statusRule = RESTORE_STATUS_RULES[collection];
  if (statusRule) {
    const status = data.status;
    if (status === "locked") {
      data.status = "confirmed";
    } else if (status === undefined) {
      if (!statusRule.optional) return null;
    } else if (!statusRule.allowed.includes(status as string)) {
      return null;
    }
  }
  for (const field of RESTORE_ACTOR_FIELDS[collection] ?? []) {
    if (field in data) data[field] = ctx.actorUid;
  }
  for (const field of ADMIN_ONLY_FIELDS) {
    delete data[field];
  }
  for (const field of RESTORE_DATE_FIELDS[collection] ?? []) {
    if (inClosedRange(data[field], ctx.closedRanges)) return null;
  }
  if (collection === "members") {
    // ownerロールの注入を防ぎ、uidフィールドをdoc IDに揃える
    if (data.role !== "editor" && data.role !== "viewer") return null;
    data.uid = targetId;
    data.invitedBy = ctx.actorUid;
  }
  if (collection === "receipts") {
    // storagePath/mimeTypeの任意値による任意オブジェクト参照を防ぐ
    if (
      typeof data.storagePath !== "string" ||
      !data.storagePath.startsWith("receipts/") ||
      !isAllowedReceiptMime(data.mimeType)
    ) {
      return null;
    }
  }
  return data;
}

/** 単一参照の張り替え表。値がIDの場合のみ書き換える */
const SINGLE_REF_FIELDS: Record<string, [field: string, collection: string][]> =
  {
    expenses: [
      ["transactionId", "transactions"],
      ["receiptId", "receipts"],
    ],
    withholdingRecords: [["transactionId", "transactions"]],
    receipts: [["transactionId", "transactions"]],
    projects: [["customerId", "customers"]],
    invoices: [
      ["customerId", "customers"],
      ["projectId", "projects"],
      ["quoteId", "quotes"],
    ],
    quotes: [
      ["customerId", "customers"],
      ["projectId", "projects"],
    ],
    payments: [
      ["invoiceId", "invoices"],
      ["transactionId", "transactions"],
    ],
    recurringInvoiceTemplates: [
      ["customerId", "customers"],
      ["projectId", "projects"],
    ],
    billPayments: [
      ["billId", "bills"],
      ["transactionId", "transactions"],
    ],
    closingChecks: [["fiscalPeriodId", "fiscalPeriods"]],
  };

/** 配列参照の張り替え表 */
const ARRAY_REF_FIELDS: Record<string, [field: string, collection: string][]> =
  {
    transactions: [["receiptIds", "receipts"]],
  };

/** journalEntries.sourceType → 参照先コレクション */
const SOURCE_TYPE_COLLECTION: Record<string, string> = {
  transaction: "transactions",
  expense: "expenses",
  invoice: "invoices",
};

/** aiSuggestions.target.type → 参照先コレクション */
const TARGET_TYPE_COLLECTION: Record<string, string> = {
  receipt: "receipts",
  transaction: "transactions",
  monthlySummary: "monthlySummaries",
};

export interface RestoreWrite {
  collection: string;
  id: string;
  /** JSON形式のドキュメント。idフィールドは確定後の書き込み先IDを含む */
  data: Record<string, unknown>;
}

export interface RestorePlan {
  writes: RestoreWrite[];
  /** コレクションごとの件数 */
  counts: Record<string, { written: number; skipped: number }>;
  /** ID衝突で新規採番されたドキュメント数 */
  remappedCount: number;
}

/**
 * 復元の書き込み計画を立てる純粋関数(テスト容易性のためFirestore非依存)。
 * - 既存IDと衝突するドキュメントは新規IDを採番し、参照フィールドを張り替える
 * - FIXED_ID_COLLECTIONSの衝突は既存を維持してskip
 * - membersのうち protectedUids(復元実行者・事業owner)は常にskip
 *   (自身のロールをバックアップ内容で降格・喪失させないため)
 */
export function planRestore(
  backup: ParsedBackupFile,
  existingIds: ReadonlyMap<string, ReadonlySet<string>>,
  opts: {
    targetBusinessId: string;
    protectedUids?: readonly string[];
    /** 復元実行者。帰属フィールド(createdBy等)をこのuidへ上書きする */
    actorUid: string;
    /** 復元先事業の既存closed期間。この範囲の日付を持つdocはskipする */
    closedRanges?: readonly { startDate: string; endDate: string }[];
    newId: () => string;
  },
): RestorePlan {
  const sanitizeCtx = {
    actorUid: opts.actorUid,
    targetBusinessId: opts.targetBusinessId,
    closedRanges: opts.closedRanges ?? [],
  };
  const protectedUids = new Set(opts.protectedUids ?? []);

  // pass1: ID衝突の解決(ランダム採番コレクションのみ)。
  // 参照張り替えは旧ID→新IDの1対1対応で行うため、ファイル内で
  // 同一IDが重複する場合は先頭出現のみを対応表に登録し、
  // 2件目以降はpass2で個別に採番する(参照は先頭のドキュメントを指す)
  const remap = new Map<string, string>();
  for (const name of BACKUP_COLLECTIONS) {
    // withholdingRecords は doc ID = transactionId であり、ランダム採番すると
    // 取引との1:1対応が壊れる。書き込み先IDはリンク先取引の確定IDを使う
    if (FIXED_ID_COLLECTIONS.has(name) || name === "withholdingRecords") {
      continue;
    }
    const assigned = new Set(existingIds.get(name) ?? []);
    const seen = new Set<string>();
    for (const doc of backup.collections[name] ?? []) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const key = `${name}/${doc.id}`;
      if (assigned.has(doc.id)) {
        let next = opts.newId();
        while (assigned.has(next)) next = opts.newId();
        remap.set(key, next);
        assigned.add(next);
      } else {
        assigned.add(doc.id);
      }
    }
  }
  const remapId = (collection: string, id: string): string =>
    remap.get(`${collection}/${id}`) ?? id;

  // "businesses/{srcBiz}/{collection}/{id}" 形式の識別パスを書き換える
  const remapPath = (path: string): string => {
    const segments = path.split("/");
    if (segments[0] === "businesses" && segments[1] === backup.businessId) {
      segments[1] = opts.targetBusinessId;
    }
    for (let i = 0; i + 1 < segments.length; i++) {
      segments[i + 1] = remapId(segments[i], segments[i + 1]);
    }
    return segments.join("/");
  };

  const rewriteDoc = (
    collection: string,
    doc: BackupDoc,
    targetId: string,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(doc)) {
      if (key !== "id") out[key] = value;
    }
    // ドメインのエンティティはdocデータ内にもidを持つため、
    // 確定した書き込み先IDをデータ側にも設定する
    out.id = targetId;

    if (out.businessId === backup.businessId) {
      out.businessId = opts.targetBusinessId;
    }
    if (typeof out.targetPath === "string") {
      out.targetPath = remapPath(out.targetPath);
    }
    for (const [field, refCollection] of SINGLE_REF_FIELDS[collection] ?? []) {
      const value = out[field];
      if (typeof value === "string") out[field] = remapId(refCollection, value);
    }
    for (const [field, refCollection] of ARRAY_REF_FIELDS[collection] ?? []) {
      const value = out[field];
      if (Array.isArray(value)) {
        out[field] = value.map((item) =>
          typeof item === "string" ? remapId(refCollection, item) : item,
        );
      }
    }
    if (collection === "journalEntries") {
      const refCollection = SOURCE_TYPE_COLLECTION[String(out.sourceType)];
      if (refCollection && typeof out.sourceId === "string") {
        out.sourceId = remapId(refCollection, out.sourceId);
      }
    }
    if (collection === "aiSuggestions") {
      const target = out.target;
      if (
        target !== null &&
        typeof target === "object" &&
        typeof (target as { type?: unknown }).type === "string" &&
        typeof (target as { id?: unknown }).id === "string"
      ) {
        const t = target as { type: string; id: string };
        const refCollection = TARGET_TYPE_COLLECTION[t.type];
        if (refCollection) {
          out.target = { ...t, id: remapId(refCollection, t.id) };
        }
      }
    }
    return out;
  };

  const counts: Record<string, { written: number; skipped: number }> = {};
  const writes: RestoreWrite[] = [];
  let remappedCount = 0;
  // バックアップ内の取引日付表。withholdingRecords の closed期間混入検査用
  // (レコード自体は日付を持たず、リンク先取引の日付が締め済み期間を決める)
  const backupTxDates = new Map<string, string>();
  for (const doc of backup.collections.transactions ?? []) {
    if (typeof doc.date === "string") backupTxDates.set(doc.id, doc.date);
  }
  for (const name of BACKUP_COLLECTIONS) {
    const docs = backup.collections[name] ?? [];
    const count = { written: 0, skipped: 0 };
    counts[name] = count;
    // 監査・派生・AI管理のコレクションは復元対象外(R2-2)
    if (NON_RESTORABLE_COLLECTIONS.has(name)) {
      count.skipped = docs.length;
      continue;
    }
    // claimedは確定済みの書き込み先ID(既存 + 本計画内で確保済み)
    const claimed = new Set(existingIds.get(name) ?? []);
    for (const doc of docs) {
      if (name === "members" && protectedUids.has(doc.id)) {
        count.skipped++;
        continue;
      }
      if (name === "withholdingRecords") {
        // doc ID = transactionId の1:1付属データ。書き込み先IDは
        // リンク先取引の確定ID(リマップ適用後)に揃える。
        // 取引がclosed期間の日付ならその取引自体が復元対象外のためskip
        const target = remapId("transactions", doc.id);
        if (
          claimed.has(target) ||
          inClosedRange(backupTxDates.get(doc.id), sanitizeCtx.closedRanges)
        ) {
          count.skipped++;
          continue;
        }
        claimed.add(target);
        const sanitized = sanitizeRestoredDoc(
          name,
          rewriteDoc(name, doc, target),
          target,
          sanitizeCtx,
        );
        // doc IDとtransactionIdの不一致はルール不変条件に反するためskip
        if (sanitized === null || sanitized.transactionId !== target) {
          count.skipped++;
          continue;
        }
        if (target !== doc.id) remappedCount++;
        writes.push({ collection: name, id: target, data: sanitized });
        count.written++;
        continue;
      }
      if (FIXED_ID_COLLECTIONS.has(name)) {
        if (claimed.has(doc.id)) {
          count.skipped++;
          continue;
        }
        claimed.add(doc.id);
        const sanitized = sanitizeRestoredDoc(
          name,
          rewriteDoc(name, doc, doc.id),
          doc.id,
          sanitizeCtx,
        );
        if (sanitized === null) {
          count.skipped++;
          continue;
        }
        writes.push({ collection: name, id: doc.id, data: sanitized });
        count.written++;
        continue;
      }
      let target = remapId(name, doc.id);
      if (claimed.has(target)) {
        // ファイル内の重複ID等: 書き込み先が確保済みなら別IDを採番
        do {
          target = opts.newId();
        } while (claimed.has(target));
      }
      claimed.add(target);
      const sanitized = sanitizeRestoredDoc(
        name,
        rewriteDoc(name, doc, target),
        target,
        sanitizeCtx,
      );
      if (sanitized === null) {
        count.skipped++;
        continue;
      }
      if (target !== doc.id) remappedCount++;
      writes.push({ collection: name, id: target, data: sanitized });
      count.written++;
    }
  }
  return { writes, counts, remappedCount };
}

export interface RestoreSummary {
  counts: Record<string, { written: number; skipped: number }>;
  remappedCount: number;
  businessUpdated: boolean;
}

/** Firestoreバッチの上限(500)に対する安全側のチャンク幅 */
const BATCH_CHUNK = 400;

/**
 * バックアップJSONを businessId の事業へ書き戻す。
 * 既存データは残し、衝突IDのみ新規採番するマージ型の復元(全削除はしない)。
 * 呼び出し側で認可(owner)済みのこと。監査ログへの記録も呼び出し側の責務。
 */
export async function restoreBusinessBackup(
  db: Firestore,
  businessId: string,
  backup: ParsedBackupFile,
  actor: { uid: string },
): Promise<RestoreSummary> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) {
    throw new ApiError("NOT_FOUND", "事業が見つかりません");
  }
  const ownerUid = businessSnap.data()?.ownerUid;

  // 既存ドキュメントIDを収集(listDocumentsはデータを読まずIDのみ)
  const existingIds = new Map<string, Set<string>>();
  for (const name of BACKUP_COLLECTIONS) {
    const refs = await businessRef.collection(name).listDocuments();
    existingIds.set(name, new Set(refs.map((r) => r.id)));
  }

  // 既存のclosed期間。この範囲の日付を持つdocは
  // 「締め済み期間のデータを変更しない」の不変条件のため復元しない
  const periodsSnap = await businessRef.collection("fiscalPeriods").get();
  const closedRanges = periodsSnap.docs
    .map((d) => d.data())
    .filter((p) => p.status === "closed")
    .map((p) => ({
      startDate: String(p.startDate),
      endDate: String(p.endDate),
    }));

  const plan = planRestore(backup, existingIds, {
    targetBusinessId: businessId,
    protectedUids: [actor.uid, ownerUid].filter(
      (v): v is string => typeof v === "string",
    ),
    actorUid: actor.uid,
    closedRanges,
    newId: () => businessRef.collection("transactions").doc().id,
  });

  for (let i = 0; i < plan.writes.length; i += BATCH_CHUNK) {
    const batch = db.batch();
    for (const write of plan.writes.slice(i, i + BATCH_CHUNK)) {
      const ref = businessRef.collection(write.collection).doc(write.id);
      batch.set(ref, fromJsonDoc(write.data));
    }
    await batch.commit();
  }

  // businessドキュメントはスキーマで許可されたフィールドのみmerge
  // (ownerUid・idはバックアップ内容で上書きされない)
  let businessUpdated = false;
  if (backup.business && Object.keys(backup.business).length > 0) {
    await businessRef.set(
      { ...backup.business, updatedAt: new Date() },
      { merge: true },
    );
    businessUpdated = true;
  }

  return {
    counts: plan.counts,
    remappedCount: plan.remappedCount,
    businessUpdated,
  };
}
