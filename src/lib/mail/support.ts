import { APP_VERSION } from "@/lib/version";
import type { MailMessage } from "./sender";

/**
 * サポート窓口のメールアドレス。
 * NEXT_PUBLIC_SUPPORT_EMAIL で差し替え可能。
 * 未設定時はプレースホルダー(support@example.com)のため、
 * 公開前に正式な窓口アドレスを設定すること。
 * (クライアントでも使うため NEXT_PUBLIC_ の静的参照)
 */
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@example.com";

/** お問い合わせ種別の選択肢(設定画面のサポートフォームで使用) */
export const SUPPORT_CATEGORIES = [
  "使い方について",
  "不具合の報告",
  "機能の要望",
  "アカウント・データについて",
  "その他",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/**
 * サポート宛の問い合わせメール下書きを組み立てる。
 * 本文にはアプリバージョンのみを自動付記し、メールアドレス・
 * businessId 等の個人情報・識別子は自動では含めない
 * (送信者情報は利用者のメーラーが付与し、利用者自身が確認して送信する)。
 */
export function buildSupportMail(input: {
  category?: string;
  message?: string;
}): MailMessage {
  const category = input.category?.trim();
  const message = input.message?.trim();
  return {
    to: SUPPORT_EMAIL,
    subject: `[Solo Accounting AI] お問い合わせ${category ? `(${category})` : ""}`,
    body: [
      message || "お問い合わせ内容をここにご記入ください。",
      "",
      "---",
      `アプリバージョン: ${APP_VERSION}`,
      "(不具合のご報告の場合は、発生時の操作手順もあわせてお知らせいただけると助かります)",
    ].join("\n"),
  };
}
