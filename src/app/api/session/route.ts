import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";
import { clientIpKey, sessionRateLimiter } from "@/lib/api/rate-limit";
import { ApiError, toErrorResponse } from "@/lib/api/result";
import { SESSION_COOKIE } from "@/lib/api/session";
import { upsertUserProfile } from "@/lib/api/queries";

const SESSION_MAX_AGE_SEC = 60 * 60; // IDトークンの有効期間(1h)に合わせる
// Firebase IDトークンは数KB。常識外のサイズは検証せず弾く
const MAX_ID_TOKEN_BYTES = 16 * 1024;

/**
 * ブラウザからの同一オリジンPOSTのみ受け付ける。
 * cross-site からのPOSTを弾くことで、攻撃者が用意したIDトークンの
 * セッションCookieを被害者ブラウザへ植え付ける login CSRF を防ぐ。
 * Sec-Fetch-Site 非対応ブラウザは Origin ヘッダのホスト一致で判定する。
 * (curl等の非ブラウザはトークン自体を持ち得ないためヘッダ未送信を許容)
 */
function assertSameOrigin(request: Request): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    throw new ApiError("FORBIDDEN", "オリジンが一致しません");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ApiError("FORBIDDEN", "オリジンが一致しません");
    }
    if (originHost !== request.headers.get("host")) {
      throw new ApiError("FORBIDDEN", "オリジンが一致しません");
    }
  }
}

/**
 * ログイン後にクライアントから呼ばれ、IDトークンを検証して
 * httpOnlyのセッションCookieを発行する。
 * Server Actions / Route Handlers の認証はこのCookieで行う。
 */
export async function POST(request: Request) {
  try {
    // verifyIdToken の署名検証コストを悪用した連打をIP単位で制限する。
    // Emulator環境(開発/E2E)では全クライアントが同一IPキーになり、
    // テストで生成する多数のユーザーが確実に上限へ達するためスキップする。
    // 本番では FIREBASE_AUTH_EMULATOR_HOST は設定されず常に有効。
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      sessionRateLimiter.consume(clientIpKey(request));
    }
    assertSameOrigin(request);
    const body: unknown = await request.json().catch(() => {
      throw new ApiError("INVALID_INPUT", "JSONボディが不正です");
    });
    const idToken =
      typeof body === "object" && body !== null && "idToken" in body
        ? String((body as { idToken: unknown }).idToken)
        : "";
    if (!idToken || idToken.length > MAX_ID_TOKEN_BYTES) {
      throw new ApiError("INVALID_INPUT", "IDトークンが必要です");
    }

    let decoded;
    try {
      // checkRevoked: 無効化済みアカウントの新規セッション発行を防ぐ
      decoded = await getAdminAuth().verifyIdToken(idToken, true);
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
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (e) {
    return toErrorResponse(e);
  }
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
