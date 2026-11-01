import { registerReceipt } from "@/lib/accounting/services/receipts";
import { ApiError, toActionError } from "@/lib/api/result";
import { requireEditor } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { getAdminBucket } from "@/lib/firebase/admin";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.一-龠ぁ-んァ-ヶ-]/g, "_").slice(-80);
  return cleaned || "receipt";
}

/**
 * 証憑ファイルのアップロード。
 * multipart/form-data: businessId, file
 * Storage保存 + receiptsメタデータ登録をサーバーサイドで行うため、
 * クライアントはStorage SDKに触れない。
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const businessId = String(form.get("businessId") ?? "");
    const file = form.get("file");
    if (!businessId || !(file instanceof File)) {
      throw new ApiError("INVALID_INPUT", "businessId と file が必要です");
    }
    const actor = await requireEditor(businessId);

    if (!ALLOWED_MIME.has(file.type)) {
      throw new ApiError(
        "INVALID_INPUT",
        "対応形式は画像(JPEG/PNG/WebP/HEIC)とPDFです",
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new ApiError(
        "INVALID_INPUT",
        "ファイルは10MB以下にしてください",
      );
    }

    const receiptId = crypto.randomUUID();
    const fileName = sanitizeFileName(file.name || "receipt");
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
    const err = toActionError(e);
    const status =
      err.code === "UNAUTHORIZED" ? 401 : err.code === "FORBIDDEN" ? 403 : 400;
    return Response.json({ ok: false, error: err }, { status });
  }
}
