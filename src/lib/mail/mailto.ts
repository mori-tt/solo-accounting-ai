import type { MailMessage, MailSender, MailSendResult } from "./sender";

/**
 * mailto: URL を組み立てる(RFC 6068)。
 * subject/body は encodeURIComponent で percent-encoding する。
 * URLSearchParams は空白を "+" に変換するため、メーラーによっては
 * 件名・本文にそのまま表示されることがあり、ここでは使わない。
 */
export function buildMailtoUrl(message: MailMessage): string {
  const query = [
    ["subject", message.subject],
    ["body", message.body],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  const to = (message.to ?? "").trim();
  return `mailto:${to}${query ? `?${query}` : ""}`;
}

/**
 * mailto: を使った送信実装。端末の既定メーラーで下書きを開くだけで、
 * アプリ自身は送信しない(添付・宛先確認・送信操作は利用者が行う)。
 */
export class MailtoMailSender implements MailSender {
  readonly kind = "mailto";

  /**
   * @param navigate URL遷移の実体(テスト差し替え用)。
   *   既定は location.assign による mailto 遷移。
   */
  constructor(
    private readonly navigate: (url: string) => void = (url) =>
      window.location.assign(url),
  ) {}

  async send(message: MailMessage): Promise<MailSendResult> {
    if (typeof window === "undefined") {
      return { ok: false, error: "この環境ではメーラーを起動できません" };
    }
    // メーラーの有無・起動成否はブラウザから検知できないため、
    // 遷移を発行できれば ok とする
    this.navigate(buildMailtoUrl(message));
    return { ok: true };
  }
}
