"use client";

import { listAISuggestions } from "@/lib/ai/client";
import type { SuggestionKind, SuggestionTarget } from "@/lib/ai/types";
import { useApiData } from "./use-api-data";

/**
 * 対象(取引・月次集計など)に紐づくAI提案一覧を取得する。
 * GET /api/ai/suggestions 経由(fetchのみ)。businessId未確定の間は空配列。
 */
export function useAISuggestions(
  businessId: string | null,
  target: SuggestionTarget,
  kind?: SuggestionKind,
) {
  return useApiData(
    () =>
      businessId
        ? listAISuggestions(businessId, {
            targetType: target.type,
            targetId: target.id,
            kind,
          })
        : Promise.resolve([]),
    [businessId, target.type, target.id, kind],
  );
}
