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

/**
 * Route Handler の `{ ok, data | error }` レスポンスを処理する fetch ラッパー。
 * callApi と同様に UNAUTHORIZED 時はセッションを張り直して1回リトライする。
 * body に文字列を渡す場合のみ JSON の content-type を付ける
 * (FormData 送信時はブラウザの multipart 境界に任せる)。
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res = await requestApi<T>(path, init);
  if (!res.ok && res.error.code === "UNAUTHORIZED") {
    if (await refreshSession(true)) {
      res = await requestApi<T>(path, init);
    }
  }
  if (!res.ok) {
    throw new ApiClientError(res.error.code, res.error.message);
  }
  return res.data;
}

async function requestApi<T>(
  path: string,
  init?: RequestInit,
): Promise<ActionResult<T>> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(typeof init?.body === "string"
        ? { "content-type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  const json = (await res
    .json()
    .catch(() => null)) as ActionResult<T> | null;
  if (!json || typeof json.ok !== "boolean") {
    return {
      ok: false,
      error: { code: "INTERNAL", message: "サーバーエラーが発生しました" },
    };
  }
  return json;
}
