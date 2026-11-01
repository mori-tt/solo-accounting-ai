import { toActionError, ApiError } from "@/lib/api/result";
import { requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { getReceiptsBucket } from "@/lib/firebase/admin";

/**
 * 証憑ファイルの取得(プレビュー/ダウンロード用)。
 * GET /api/receipts/{receiptId}?businessId=...
 * メンバーシップを検証してからStorageの内容をストリーム返却する。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  try {
    const { receiptId } = await params;
    const businessId = new URL(request.url).searchParams.get("businessId") ?? "";
    if (!businessId || !receiptId) {
      throw new ApiError("INVALID_INPUT", "businessId が必要です");
    }
    await requireViewer(businessId);

    const receipt = await getStore().getReceipt(businessId, receiptId);
    if (!receipt) {
      throw new ApiError("NOT_FOUND", "証憑が見つかりません");
    }
    const [buffer] = await getReceiptsBucket()
      .file(receipt.storagePath)
      .download();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": receipt.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(receipt.fileName)}`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    const err = toActionError(e);
    const status =
      err.code === "UNAUTHORIZED"
        ? 401
        : err.code === "FORBIDDEN"
          ? 403
          : err.code === "NOT_FOUND"
            ? 404
            : 400;
    return Response.json({ ok: false, error: err }, { status });
  }
}
