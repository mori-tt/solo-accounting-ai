/**
 * メール送信の抽象インターフェース。
 *
 * 現状の実装はユーザーのメーラーに下書きを渡す mailto のみ
 * (外部送信基盤は不要。実送信は利用者のメーラーが行う)。
 * 将来 SendGrid 等の外部送信基盤を接続する場合は、この
 * MailSender を実装した別実装を getMailSender から返す。
 */

/** 送信するメール1通分の内容 */
export interface MailMessage {
  /** 宛先メールアドレス。省略時は利用者がメーラー上で入力する */
  to?: string;
  subject: string;
  /** 平文の本文(改行可) */
  body: string;
}

export type MailSendResult = { ok: true } | { ok: false; error: string };

/**
 * メール送信手段の抽象。実装ごとに「送信」の意味が異なる:
 * - mailto: 端末の既定メーラーを起動して下書きを開く
 *   (実送信は利用者がメーラー上で行う)
 * - 将来の外部基盤(SendGrid等): API呼び出しによるサーバー側送信
 */
export interface MailSender {
  /** 実装識別子(例: "mailto") */
  readonly kind: string;
  send(message: MailMessage): Promise<MailSendResult>;
}
