import { realpathSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
