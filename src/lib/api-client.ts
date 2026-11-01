"use client";

import type {
  AISuggestionJSON,
  SuggestionKind,
  SuggestionStatus,
  SuggestionTarget,
  SuggestionTargetType,
} from "@/lib/ai/types";
import type { ActionResult } from "@/lib/api/result";
import { getFirebaseAuth } from "@/lib/firebase/client";

/**
 * Server Action 呼び出しラッパー。
 * - UNAUTHORIZED が返った場合はIDトークンを再取得してセッションCookieを
 *   更新し、1回だけリトライする(Cookie失効対策)
 * - 失敗は ApiClientError として throw し、画面側でエラー状態を表示する
 */
export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** 現在のIDトークンでセッションCookieを更新する。未ログインなら false。 */
export async function refreshSession(forceRefresh = false): Promise<boolean> {
  const user = getFirebaseAuth().currentUser;
  if (!user) return false;
  const idToken = await user.getIdToken(forceRefresh);
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  return res.ok;
}

export async function clearSession(): Promise<void> {
  try {
    await fetch("/api/session", { method: "DELETE" });
  } catch {
    // ネットワーク断でもクライアント側ログアウトは進める
  }
}

export async function callApi<T>(
  action: () => Promise<ActionResult<T>>,
): Promise<T> {
  let res = await action();
  if (!res.ok && res.error.code === "UNAUTHORIZED") {
    // Cookie切れの可能性。トークン再取得でセッションを張り直してリトライ
    if (await refreshSession(true)) {
      res = await action();
    }
  }
  if (!res.ok) {
    throw new ApiClientError(res.error.code, res.error.message);
  }
  return res.data;
}

// ---------- AI提案 API(/api/ai/suggestions) ----------

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
  });
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !body?.ok) {
    throw new ApiClientError(
      body?.error?.code ?? "INTERNAL",
      body?.error?.message ?? "通信に失敗しました",
    );
  }
  return body.data as T;
}

/** 提案一覧。絞り込み条件はGETクエリ相当 */
export async function fetchAiSuggestions(
  businessId: string,
  filter: {
    targetType?: SuggestionTargetType;
    targetId?: string;
    kind?: SuggestionKind;
    status?: SuggestionStatus;
    limit?: number;
  } = {},
): Promise<AISuggestionJSON[]> {
  const params = new URLSearchParams({ businessId });
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return requestJson<AISuggestionJSON[]>(`/api/ai/suggestions?${params}`);
}

/** AI提案を実行する(対象・種別はサーバー側でも検証される) */
export async function runAiSuggestion(
  businessId: string,
  kind: SuggestionKind,
  target: SuggestionTarget,
  input: Record<string, unknown> = {},
): Promise<AISuggestionJSON> {
  return requestJson<AISuggestionJSON>("/api/ai/suggestions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessId, kind, target, input }),
  });
}

/** 提案を承認(accepted)・却下(rejected)する。確定データへの反映は行われない */
export async function decideAiSuggestion(
  businessId: string,
  suggestionId: string,
  decision: "accepted" | "rejected",
  rejectReason?: string,
): Promise<AISuggestionJSON> {
  return requestJson<AISuggestionJSON>(`/api/ai/suggestions/${suggestionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessId, decision, rejectReason }),
  });
}
