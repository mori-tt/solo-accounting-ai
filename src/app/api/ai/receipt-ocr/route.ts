import { z } from "zod";
import { AIProcessingError, AITimeoutError } from "@/lib/ai/errors";
import { createAIProvider } from "@/lib/ai/llm-provider";
import {
  createReceiptOcr,
  isOcrSupportedMimeType,
  isReceiptOcrAvailable,
  ReceiptOcrResolver,
} from "@/lib/ai/receipt-ocr";
import {
  defaultConfidence,
  fallbackReason,
  normalizeAIResponse,
} from "@/lib/ai/schemas";
import { ApiError, toActionError } from "@/lib/api/result";
import { requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { getAdminBucket } from "@/lib/firebase/admin";
import { parseForm } from "@/lib/validation/schemas";

/**
 * 領収書OCRの実行経路。OCRテキスト・証憑内容・SDKのエラーメッセージは
 * ログに出力しない(プロジェクト規約)。
 * 提案ドキュメント(aiSuggestions)は作成せず、抽出値をその場で返すのみ。
 * 確定データへの反映は必ずクライアント側の保存操作を経る(AI_POLICY)。
 */

// OCR(画像→テキスト)+抽出(テキスト→項目)の2段呼び出しをまとめて制限する
const OCR_TOTAL_TIMEOUT_MS = 60_000;

const ocrRequestSchema = z.object({
  businessId: z.string().min(1),
  receiptId: z.string().min(1).max(200),
});

function errorResponse(e: unknown): Response {
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

/**
 * OCR機能の利用可否(AI_OCR_PROVIDER/OPENAI_API_KEYの設定)を返す。
 * GET /api/ai/receipt-ocr?businessId=...
 * viewer以上。設定状態のみを返し、鍵やファイル内容は含まない。
 */
export async function GET(request: Request) {
  try {
    const businessId =
      new URL(request.url).searchParams.get("businessId") ?? "";
    if (!businessId) {
      throw new ApiError("INVALID_INPUT", "businessId が必要です");
    }
    await requireViewer(businessId);
    return Response.json({
      ok: true,
      data: { available: isReceiptOcrAvailable() },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * 証憑ファイルをOCRして日付・金額・取引先の抽出値を返す。
 * POST /api/ai/receipt-ocr
 * body: { businessId, receiptId }
 * storagePathはクライアントから受け取らず、サーバー登録済みのreceipt
 * レコードから解決する(任意パス参照を防ぐ)。viewer以上。
 * OCR未設定時は { ok:false, error.code:"OCR_UNAVAILABLE" } を返す。
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => {
      throw new ApiError("INVALID_INPUT", "JSONボディが不正です");
    });
    const parsed = parseForm(ocrRequestSchema, body);
    if (!parsed.success) {
      throw new ApiError("INVALID_INPUT", parsed.issues.join(" / "));
    }
    const { businessId, receiptId } = parsed.data;
    await requireViewer(businessId);

    const ocr = createReceiptOcr();
    if (!ocr) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "OCR_UNAVAILABLE",
            message: "OCRが設定されていません(AI_OCR_PROVIDER)",
          },
        },
        { status: 400 },
      );
    }

    // businessId内の証憑のみ対象にする(他businessIdの証憑はNOT_FOUND)
    const receipt = await getStore().getReceipt(businessId, receiptId);
    if (!receipt) {
      throw new ApiError("NOT_FOUND", "証憑が見つかりません");
    }
    if (!isOcrSupportedMimeType(receipt.mimeType)) {
      throw new ApiError(
        "INVALID_INPUT",
        "このファイル形式はOCRに対応していません(JPEG/PNG/WebP/GIF/PDF)",
      );
    }

    const provider = new ReceiptOcrResolver({
      inner: createAIProvider(),
      ocr,
      getReceipt: async () => receipt,
      downloadFile: async (storagePath) => {
        const [buffer] = await getAdminBucket()
          .file(storagePath)
          .download();
        return buffer;
      },
    });

    let normalized;
    try {
      const raw = await withTimeout(
        provider.generate({
          kind: "receipt_extraction",
          businessId,
          target: { type: "receipt", id: receiptId },
          input: {},
        }),
        OCR_TOTAL_TIMEOUT_MS,
      );
      normalized = normalizeAIResponse("receipt_extraction", raw);
    } catch (e) {
      if (e instanceof AIProcessingError) {
        throw new ApiError("INTERNAL", ocrErrorMessage(e));
      }
      throw e;
    }

    return Response.json({
      ok: true,
      data: {
        ...normalized.payload,
        confidence:
          normalized.confidence ?? defaultConfidence("receipt_extraction"),
        reason:
          normalized.reason ??
          fallbackReason("receipt_extraction", normalized.issues),
        issues: normalized.issues,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** エラーメッセージは固定文言に写す(証憑内容・個人情報を含めない) */
function ocrErrorMessage(e: AIProcessingError): string {
  if (e.message === "receipt file unavailable") {
    return "証憑ファイルを取得できませんでした";
  }
  if (e.message === "receipt file too large for OCR") {
    return "ファイルが大きすぎてOCRできません";
  }
  if (e.message === "unsupported receipt mime type for OCR") {
    return "このファイル形式はOCRに対応していません";
  }
  switch (e.code) {
    case "timeout":
      return "OCRがタイムアウトしました。再度お試しください";
    case "invalid_response":
      return "OCRの応答を解釈できませんでした。再度お試しください";
    default:
      return "OCR処理に失敗しました";
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AITimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
