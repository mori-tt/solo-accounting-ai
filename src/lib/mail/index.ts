import { MailtoMailSender } from "./mailto";
import type { MailSender } from "./sender";

export type { MailMessage, MailSender, MailSendResult } from "./sender";
export { buildMailtoUrl, MailtoMailSender } from "./mailto";
export { buildInvoiceMail } from "./invoice-mail";
export {
  SUPPORT_CATEGORIES,
  SUPPORT_EMAIL,
  buildSupportMail,
  type SupportCategory,
} from "./support";

/**
 * 現在のメール送信実装を返す。
 * 外部送信基盤(SendGrid等)を導入する際は、ここで返す実装を差し替える。
 * 現状は mailto(ユーザーのメーラー任せ)のみ。
 */
export function getMailSender(): MailSender {
  return new MailtoMailSender();
}
