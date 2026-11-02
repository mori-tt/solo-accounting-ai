import { registerReceipt } from "@/lib/accounting/services/receipts";
import { receiptUploadRateLimiter } from "@/lib/api/rate-limit";
import { ApiError, toErrorResponse } from "@/lib/api/result";
import { requireEditor, requireUid } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { getAdminBucket } from "@/lib/firebase/admin";
import {
  isAllowedReceiptMime,
  RECEIPT_MAX_FILE_BYTES,
  sanitizeReceiptFileName,
} from "@/lib/receipt-files";

/**
 * 証憑ファイルのアップロード。
 * multipart/form-data: businessId, file
 * Storage保存 + receiptsメタデータ登録をサーバーサイドで行うため、
 * クライアントはStorage SDKに触れない。
 */
export async function POST(request: Request) {
  try {
    // ボディ(multipart全体)のバッファリング前に認証のみ先行する。
    // businessId 依存のロール検証はボディ解析後に行う
    await requireUid();
    const form = await request.formData().catch(() => {
      throw new ApiError(
        "INVALID_INPUT",
        "multipart/form-data ボディが必要です",
      );
    });
    const businessId = String(form.get("businessId") ?? "");
    const file = form.get("file");
    if (!businessId || !(file instanceof File)) {
      throw new ApiError("INVALID_INPUT", "businessId と file が必要です");
    }
    const actor = await requireEditor(businessId);
    // Storage書き込み+帯域が課金対象のため businessId 単位で制限
    receiptUploadRateLimiter.consume(businessId);

    if (!isAllowedReceiptMime(file.type)) {
      throw new ApiError(
        "INVALID_INPUT",
        "対応形式は画像(JPEG/PNG/WebP/HEIC)とPDFです",
      );
    }
    if (file.size > RECEIPT_MAX_FILE_BYTES) {
      throw new ApiError(
        "INVALID_INPUT",
        "ファイルは10MB以下にしてください",
      );
    }

    const receiptId = crypto.randomUUID();
    const fileName = sanitizeReceiptFileName(file.name || "receipt");
    const storagePath = `receipts/${businessId}/${receiptId}/${fileName}`;

    const bucket = getAdminBucket();
    await bucket
      .file(storagePath)
      .save(Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
      });

    const { receipt } = await registerReceipt(getStore(), businessId, actor, {
      id: receiptId,
      storagePath,
      fileName: file.name || fileName,
      mimeType: file.type,
      idempotencyKey: `receipt-upload-${receiptId}`,
    });
    return Response.json({ ok: true, data: receipt });
  } catch (e) {
    return toErrorResponse(e);
  }
}
