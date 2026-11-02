import { receiptDownloadRateLimiter } from "@/lib/api/rate-limit";
import { ApiError, toErrorResponse } from "@/lib/api/result";
import { requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { getAdminBucket } from "@/lib/firebase/admin";
import {
  isAllowedReceiptMime,
  isReceiptStoragePathOf,
} from "@/lib/receipt-files";

/**
 * 証憑ファイルの取得(プレビュー/ダウンロード用)。
 * GET /api/receipts/{receiptId}?businessId=...
 * メンバーシップを検証してからStorageの内容をストリーム返却する。
 * receiptドキュメントの storagePath/mimeType はクライアント書き込み可能な
 * 値のため、サーバー側でも接頭辞・許可形式を再検証する(R2-1)。
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
    // サーバー経由の帯域が課金対象のため businessId 単位で制限
    receiptDownloadRateLimiter.consume(businessId);

    const receipt = await getStore().getReceipt(businessId, receiptId);
    // storagePath が receipts/{businessId}/{receiptId}/ 配下でない
    // ドキュメントは正当なアップロード経路を通っていないため、
    // 他バケットオブジェクトのプロキシ参照を防ぐため NOT_FOUND に倒す
    if (
      !receipt ||
      !isReceiptStoragePathOf(receipt.storagePath, businessId, receiptId)
    ) {
      throw new ApiError("NOT_FOUND", "証憑が見つかりません");
    }
    const [buffer] = await getAdminBucket()
      .file(receipt.storagePath)
      .download();
    // docのmimeTypeが許可形式以外(改ざん・旧データ)の場合は
    // バイナリダウンロードに固定し、ブラウザ内での解釈を防ぐ
    const safeMime = isAllowedReceiptMime(receipt.mimeType)
      ? receipt.mimeType
      : "application/octet-stream";
    const disposition = isAllowedReceiptMime(receipt.mimeType)
      ? "inline"
      : "attachment";
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": safeMime,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(receipt.fileName)}`,
        "Cache-Control": "private, max-age=60",
        // アップロードされた証憑をブラウザが別種コンテンツとして
        // 解釈するのを防ぐ(MIMEスニッフィング経由のXSS対策)
        "X-Content-Type-Options": "nosniff",
        // ユーザー提供コンテンツをドキュメントとして開いた際に
        // スクリプト/外部リソースの実行を抑止する(PDF等のpreview用)
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
