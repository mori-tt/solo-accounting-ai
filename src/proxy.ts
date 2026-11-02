import { NextResponse } from "next/server";

// Next.js 16 では middleware は proxy に改称(機能は同等)。
// ここではリクエスト単位で付与すべきレスポンスヘッダを扱う。
// 静的に決まるヘッダ(CSP等)は next.config.ts の headers() 側に残す。

const isProd = process.env.NODE_ENV === "production";

export function proxy() {
  const response = NextResponse.next();
  // HSTS は HTTPS 本番のみ付与する。開発(Emulator/localhost は http)では付けない。
  // preload ディレクティブは hstspreload.org 登録時の要件を満たす値。
  if (isProd) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  return response;
}

export const config = {
  matcher: [
    // API・静的アセット・プリフェッチは対象外。
    // nonce ベース CSP を将来導入する場合も同じ matcher を使う。
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
