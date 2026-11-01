import { getAISuggestionService } from "@/lib/api/ai";
import { ApiError, toActionError } from "@/lib/api/result";
import { requireEditor } from "@/lib/api/session";
import { decideSuggestionSchema, parseForm } from "@/lib/validation/schemas";

/**
 * 提案の承認/却下。
 * PATCH /api/ai/suggestions/{suggestionId}
 * body: { businessId, decision: "accepted" | "rejected", rejectReason? }
 * 提案レコードのstatusを解決するのみで、確定データ(Transaction等)への
 * 反映は行わない(採用後の確定コピーはユーザー操作による別操作)。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  try {
    const { suggestionId } = await params;
    const body: unknown = await request.json().catch(() => {
      throw new ApiError("INVALID_INPUT", "JSONボディが不正です");
    });
    const parsed = parseForm(decideSuggestionSchema, body);
    if (!parsed.success) {
      throw new ApiError("INVALID_INPUT", parsed.issues.join(" / "));
    }
    const { businessId, decision, rejectReason } = parsed.data;
    const actor = await requireEditor(businessId);

    const service = getAISuggestionService();
    const existing = await service.get(businessId, suggestionId);
    if (!existing) {
      throw new ApiError("NOT_FOUND", "AI提案が見つかりません");
    }
    if (existing.status === "accepted" || existing.status === "rejected") {
      throw new ApiError(
        "INVALID_INPUT",
        "このAI提案はすでに処理済みです",
      );
    }

    const suggestion =
      decision === "accepted"
        ? await service.accept(businessId, suggestionId, actor.uid)
        : await service.reject(
            businessId,
            suggestionId,
            actor.uid,
            rejectReason,
          );
    return Response.json({ ok: true, data: suggestion });
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
