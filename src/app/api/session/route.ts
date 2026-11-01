import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";
import { ApiError, toErrorResponse } from "@/lib/api/result";
import { SESSION_COOKIE } from "@/lib/api/session";
import { upsertUserProfile } from "@/lib/api/queries";

const SESSION_MAX_AGE_SEC = 60 * 60; // IDトークンの有効期間(1h)に合わせる

/**
 * ログイン後にクライアントから呼ばれ、IDトークンを検証して
 * httpOnlyのセッションCookieを発行する。
 * Server Actions / Route Handlers の認証はこのCookieで行う。
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => {
      throw new ApiError("INVALID_INPUT", "JSONボディが不正です");
    });
    const idToken =
      typeof body === "object" && body !== null && "idToken" in body
        ? String((body as { idToken: unknown }).idToken)
        : "";
    if (!idToken) {
      throw new ApiError("INVALID_INPUT", "IDトークンが必要です");
    }

    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(idToken);
    } catch {
      throw new ApiError("UNAUTHORIZED", "IDトークンが無効です");
    }

    const jar = await cookies();
    jar.set(SESSION_COOKIE, idToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SEC,
    });
    // users/{uid} を upsert(プロフィール表示用。失敗してもログインは成功扱い)
    try {
      await upsertUserProfile(decoded.uid, {
        displayName: typeof decoded.name === "string" ? decoded.name : "",
        email: typeof decoded.email === "string" ? decoded.email : "",
      });
    } catch {
      // プロフィール保存失敗はセッションを妨げない
    }
    return Response.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** ログアウト。セッションCookieを破棄する。 */
export async function DELETE() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return Response.json({ ok: true });
}
