/**
 * サイトの公開ベースURL。
 * metadataBase・sitemap・robots が絶対URLを生成するために使う。
 * 本番では NEXT_PUBLIC_SITE_URL を設定する(未設定時はローカル開発用URL)。
 */
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

export const siteName = "Solo Accounting AI";

export const siteDescription =
  "個人事業主・小規模事業者向けの経理・決算準備・確定申告準備アプリ";
