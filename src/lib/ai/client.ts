"use client";

import { apiFetch } from "@/lib/api-client";
import type {
  AISuggestionDTO,
  SuggestionKind,
  SuggestionStatus,
  SuggestionTarget,
  SuggestionTargetType,
} from "./types";

/**
 * /api/ai/suggestions のクライアント(fetch経由)。
 * aiSuggestionsコレクションへはクライアントSDKから直接書き込めない
 * (生成・更新はAdmin SDKのみ)ため、必ずこのRoute Handler経由で操作する。
 * 提案の採否(status解決)のみPATCHで行い、確定データへの反映は
 * 別途ユーザー操作(取引の編集・確定)で行う。
 */

export interface AISuggestionListFilter {
  targetType?: SuggestionTargetType;
  targetId?: string;
  kind?: SuggestionKind;
  status?: SuggestionStatus;
  limit?: number;
}

/** 提案一覧の取得(GET /api/ai/suggestions)。createdAt降順。 */
export function listAISuggestions(
  businessId: string,
  filter: AISuggestionListFilter = {},
): Promise<AISuggestionDTO[]> {
  const params = new URLSearchParams({ businessId });
  if (filter.targetType) params.set("targetType", filter.targetType);
  if (filter.targetId) params.set("targetId", filter.targetId);
  if (filter.kind) params.set("kind", filter.kind);
  if (filter.status) params.set("status", filter.status);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  return apiFetch(`/api/ai/suggestions?${params.toString()}`);
}

export interface RunAISuggestionInput {
  businessId: string;
  kind: SuggestionKind;
  target: SuggestionTarget;
  input?: Record<string, unknown>;
}

/** 提案の実行(POST /api/ai/suggestions)。失敗時もneeds_reviewの提案が返る。 */
export function runAISuggestion(
  params: RunAISuggestionInput,
): Promise<AISuggestionDTO> {
  return apiFetch("/api/ai/suggestions", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/**
 * 提案の採否(PATCH /api/ai/suggestions/{id})。
 * 提案レコードのstatusを解決するのみで、確定データには書き込まない。
 */
export function decideAISuggestion(params: {
  businessId: string;
  suggestionId: string;
  decision: "accepted" | "rejected";
  rejectReason?: string;
}): Promise<AISuggestionDTO> {
  const { suggestionId, ...body } = params;
  return apiFetch(
    `/api/ai/suggestions/${encodeURIComponent(suggestionId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
}
