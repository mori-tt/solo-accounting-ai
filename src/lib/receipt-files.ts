/**
 * 証憑ファイルの許可ポリシー。
 * アップロード(POST /api/receipts)・ダウンロード(GET /api/receipts/[id])・
 * OCR(src/lib/ai/receipt-ocr.ts)・Storage/Firestore Rules(storage.rules /
 * firestore.rules の validReceipt)で同一基準を使うためここに集約する。
 * Rules側は別言語のため値をコピーで同期すること。
 */

export const RECEIPT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export const ALLOWED_RECEIPT_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

/** サーバーが生成するstoragePathの接頭辞: receipts/{businessId}/{receiptId}/ */
export function isReceiptStoragePathOf(
  storagePath: unknown,
  businessId: string,
  receiptId: string,
): boolean {
  return (
    typeof storagePath === "string" &&
    storagePath.startsWith(`receipts/${businessId}/${receiptId}/`)
  );
}

export function isAllowedReceiptMime(value: unknown): value is string {
  return typeof value === "string" && ALLOWED_RECEIPT_MIME.has(value);
}

/** storagePath用のファイル名。区切り文字等を潰してtraversalを防ぐ */
export function sanitizeReceiptFileName(name: string): string {
  const cleaned = name.replace(/[^\w.一-龠ぁ-んァ-ヶ-]/g, "_").slice(-80);
  return cleaned || "receipt";
}
