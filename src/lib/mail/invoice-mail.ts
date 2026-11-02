import type { Invoice } from "@/lib/accounting/types";
import { formatDateJP, formatYen } from "@/lib/format";
import type { MailMessage } from "./sender";

/**
 * 請求書送付メールの定型文を組み立てる。
 * 件名・本文に請求書番号・請求金額・支払期日を含める。
 * mailto: ではファイルを添付できないため、送信前に請求書を
 * 添付するよう促す注意書きを末尾に入れる。
 */
export function buildInvoiceMail(input: {
  invoice: Pick<
    Invoice,
    "id" | "invoiceNumber" | "issueDate" | "dueDate" | "totalAmount"
  >;
  customerName?: string;
  customerEmail?: string;
  /** 発行者名(事業の issuerName または事業名) */
  issuerName?: string;
}): MailMessage {
  const { invoice, customerName, customerEmail, issuerName } = input;
  const number = invoice.invoiceNumber ?? invoice.id;
  const lines = [
    customerName ? `${customerName} 御中` : "ご担当者様",
    "",
    "いつもお世話になっております。",
    "下記のとおり請求書をお送りいたします。",
    "",
    `請求書番号: ${number}`,
    `発行日: ${formatDateJP(invoice.issueDate)}`,
    `お支払期日: ${formatDateJP(invoice.dueDate)}`,
    `ご請求金額: ${formatYen(invoice.totalAmount)}(税込)`,
    "",
    "内容をご確認のうえ、お支払期日までにお支払いをお願いいたします。",
    "",
    ...(issuerName?.trim() ? [issuerName.trim(), ""] : []),
    "※ このメールはアプリが作成した下書きです。送信前に請求書ファイルの添付と内容をご確認ください。",
  ];
  return {
    to: customerEmail?.trim() || undefined,
    subject: `【ご請求】請求書 ${number} のお知らせ`,
    body: lines.join("\n"),
  };
}
