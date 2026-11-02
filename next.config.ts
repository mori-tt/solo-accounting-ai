import { realpathSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import {
  EMULATOR_DEFAULTS,
  parseEmulatorHost,
  shouldUseEmulator,
} from "./src/lib/firebase/config";

// worktree環境で node_modules がプロジェクトルート外へのシンボリンクの場合、
// Turbopack がシンボリンク越境できるよう追加ルートを返す。
// 通常のチェックアウト(実ディレクトリ)では空を返す。
function linkedModulesRoot(): string | null {
  try {
    const real = realpathSync(path.join(process.cwd(), "node_modules"));
    const root = process.cwd() + path.sep;
    return real.startsWith(root) ? null : path.dirname(real);
  } catch {
    return null;
  }
}

const linkedRoot = linkedModulesRoot();

const isDev = process.env.NODE_ENV === "development";
const useEmulator = shouldUseEmulator();

// CSP connect-src の許可先。クライアント SDK(firebase/auth)の接続先に合わせる:
// - Emulator モード: Auth/Firestore/Storage Emulator の http://host:port
//   (client.ts の connectEmulators と同じ env/デフォルト値で解決する)
// - 本番: IDトークン検証・更新が使う Google API + authDomain
//   (firestore/storage はクライアント SDK を使わず Admin SDK 経由のため不要)
function connectSrc(): string[] {
  if (useEmulator) {
    return [
      parseEmulatorHost(
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
        EMULATOR_DEFAULTS.auth,
      ),
      parseEmulatorHost(
        process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
        EMULATOR_DEFAULTS.firestore,
      ),
      parseEmulatorHost(
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST,
        EMULATOR_DEFAULTS.storage,
      ),
    ].map(({ host, port }) => `http://${host}:${port}`);
  }
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  return [
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    ...(authDomain ? [`https://${authDomain}`] : []),
  ];
}

// nonceなしの静的CSP(middleware/proxy非依存)。inline script/style は
// Next.js の bootstrap が埋め込むため 'unsafe-inline' を許可し、
// 開発時のみ React の eval デバッグ用に 'unsafe-eval' を足す。
// upgrade-insecure-requests は Emulator(http)利用時は付けない。
//
// nonce ベース CSP への移行は見送り(REVIEW.md 参照):
// cacheComponents 下では全ページが静的 prerender 済みHTMLとして
// verbatim 配信されるため、リクエスト毎の nonce を script に注入する
// 経路が存在しない(Next16.4 時点では TURBOPACK bootstrap 等の
// shell 内 inline script に nonce が付かない)。
// 将来 nonce CSP を proxy.ts で実装する場合は、二重ヘッダ防止のため
// ここの Content-Security-Policy を外して proxy 側へ移すこと。
// Strict-Transport-Security(本番のみ)は src/proxy.ts で付与。
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' ${connectSrc().join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(useEmulator ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    turbopackAdditionalRoots: linkedRoot
      ? { linkedModules: { path: linkedRoot } }
      : undefined,
  },
};

export default nextConfig;
