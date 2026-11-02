import type { MetadataRoute } from "next";
import { siteUrl } from "./site";

/**
 * 公開対象は LP(/)と /legal/* のみ。
 * 認証必須のアプリ画面・APIはクロール対象外にする。
 * 注意: (app) ルートグループに公開パスを追加した場合は
 * この disallow 一覧にも追加すること。
 */
const PRIVATE_PATHS = [
  "/accounts",
  "/allocations",
  "/api",
  "/audit-log",
  "/backup",
  "/business-delete",
  "/closing",
  "/customers",
  "/dashboard",
  "/expenses",
  "/fixed-assets",
  "/invoices",
  "/login",
  "/opening-balances",
  "/projects",
  "/receipts",
  "/recurring",
  "/reports",
  "/reset-password",
  "/search",
  "/settings",
  "/transactions",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: PRIVATE_PATHS,
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
