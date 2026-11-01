import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE } from "@/lib/api/session";
import { upsertUserProfile } from "@/lib/api/queries";

const SESSION_MAX_AGE_SEC = 60 * 60; // IDトークンの有効期間(1h)に合わせる

/**
 * ログイン後にクライアントから呼ばれ、IDトークンを検証して
 * httpOnlyのセッションCookieを発行する。
 * Server Actions / Route Handlers の認証はこのCookieで行う。
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  const idToken =
    typeof body === "object" && body !== null && "idToken" in body
      ? String((body as { idToken: unknown }).idToken)
      : "";
  if (!idToken) {
    return Response.json({ ok: false, error: "idToken required" }, { status: 400 });
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
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
  } catch {
    return Response.json(
      { ok: false, error: "invalid token" },
      { status: 401 },
    );
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
