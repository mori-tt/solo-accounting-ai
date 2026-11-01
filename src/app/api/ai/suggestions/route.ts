import {
  assertSuggestionTarget,
  getAISuggestionService,
} from "@/lib/api/ai";
import { ApiError, toActionError } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import {
  listSuggestionQuerySchema,
  parseForm,
  runSuggestionSchema,
} from "@/lib/validation/schemas";

// AIへ渡すinput(JSON)の上限。証憑OCRテキスト(12,000文字)+既存取引一覧程度を
// 想定し、過大なペイロードでプロバイダ呼び出しが暴走しないよう制限する。
const MAX_INPUT_JSON_CHARS = 128_000;

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
 * 提案一覧の取得。
 * GET /api/ai/suggestions?businessId=..&targetType=receipt&targetId=..&status=pending&kind=receipt_extraction&limit=50
 * viewer以上。payloadにはAI出力(抽出候補)のみが含まれ、確定データは含まない。
 */
export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = parseForm(listSuggestionQuerySchema, params);
    if (!parsed.success) {
      throw new ApiError("INVALID_INPUT", parsed.issues.join(" / "));
    }
    const q = parsed.data;
    await requireViewer(q.businessId);
    const suggestions = await getAISuggestionService().list(q.businessId, {
      targetType: q.targetType,
      targetId: q.targetId,
      kind: q.kind,
      status: q.status,
      limit: q.limit,
    });
    return Response.json({ ok: true, data: suggestions });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * AI提案の実行。aiSuggestionsドキュメントを作成し、プロバイダ呼び出し結果を
 * payload/confidence/issuesへ記録する(確定データには書き込まない)。
 * POST /api/ai/suggestions
 * body: { businessId, kind, target: { type, id }, input? }
 * 失敗・判断不能時も status=needs_review の提案が返る(再実行は別経路)。
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => {
      throw new ApiError("INVALID_INPUT", "JSONボディが不正です");
    });
    const parsed = parseForm(runSuggestionSchema, body);
    if (!parsed.success) {
      throw new ApiError("INVALID_INPUT", parsed.issues.join(" / "));
    }
    const { businessId, kind, target, input = {} } = parsed.data;
    const actor = await requireEditor(businessId);
    await assertSuggestionTarget(businessId, kind, target);
    if (JSON.stringify(input).length > MAX_INPUT_JSON_CHARS) {
      throw new ApiError("INVALID_INPUT", "AIへの入力データが大きすぎます");
    }
    const suggestion = await getAISuggestionService().run({
      businessId,
      kind,
      target,
      input,
      actorUid: actor.uid,
    });
    return Response.json({ ok: true, data: suggestion });
  } catch (e) {
    return errorResponse(e);
  }
}
