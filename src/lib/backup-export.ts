import type { Firestore } from "firebase-admin/firestore";
import { DomainError } from "./accounting/errors";

/**
 * バックアップのエクスポート側(読み取り→JSON化)。
 *
 * backup.ts(復元側・クライアント共有のzod検証)から分離したモジュール。
 * 相対importのみで構成し、Cloud Functions(functions/)からも
 * そのままコンパイルして使えるようにする(絶対パスエイリアス禁止)。
 * `import type` の firebase-admin はクライアントバンドルに残らないため、
 * backupFreshness 等の純粋関数は引き続き画面側からも参照できる。
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

/** 事業の全データをバックアップJSONとして組み立てる。呼び出し側で認可済みのこと */
export async function exportBusinessBackup(
  db: Firestore,
  businessId: string,
): Promise<BackupFile> {
  const businessRef = db.collection("businesses").doc(businessId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) {
    throw new DomainError("NOT_FOUND", `business ${businessId} not found`);
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
