"use client";

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
