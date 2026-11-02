import { Timestamp } from "firebase-admin/firestore";

/**
 * バックアップJSONの保存先オブジェクトパス(1日1世代)。
 * backups/ プレフィクスは storage.rules の許可対象外(規則は
 * receipts/ のみ許可)のため、クライアントからは読めない
 * Admin SDK 専用の領域となる。
 */
export function backupObjectPath(businessId: string, date: string): string {
  return `backups/${businessId}/backup-${date}.json`;
}

/**
 * businessドキュメントの lastBackupAt を ISO 8601 文字列へ正規化する。
 * 通常は Timestamp。値欠落・旧データの文字列・不正値は undefined で
 * 「未取得」扱いにし、backupFreshness の安全側(never)へ倒す。
 */
export function lastBackupIso(data: unknown): string | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const value = (data as Record<string, unknown>).lastBackupAt;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

/** ログ出力用の短いエラーメッセージ(個人情報を含めないよう message のみ) */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
