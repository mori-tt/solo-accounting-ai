import {
  AI_RUN_LIMIT_PER_HOUR,
  aiRunRateLimiter,
} from "@/lib/api/rate-limit";
import { ApiError, toErrorResponse } from "@/lib/api/result";
import { requireViewer } from "@/lib/api/session";

/**
 * 現在ウィンドウ(1時間)のAI提案実行の残り回数を返す。
 * GET /api/ai/usage?businessId=...
 * viewer以上。インメモリの残数と上限のみを返す軽量な読み取りで、
 * 回数の消費は行わない。
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
      data: {
        remaining: aiRunRateLimiter.remaining(businessId),
        limit: AI_RUN_LIMIT_PER_HOUR,
      },
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}
