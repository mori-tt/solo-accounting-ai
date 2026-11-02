import type { Invoice, Payment } from "@/lib/accounting/types";
import { formatDateJP, formatYen } from "@/lib/format";

/**
 * 発行領収書の帳票レイアウト。入金(payments)レコードから派生生成する
 * (新コレクションは作らない)。receiptsコレクションの経費証憑とは別物。
 * 領収金額=入金額、領収日付=入金日、但し書き=元請求書の参照。
 */
export function PaymentReceiptSheet({
  invoice,
  payment,
  customerName,
  issuerName,
  issuerAddress,
  registrationNumber,
}: {
  invoice: Invoice;
  payment: Payment;
  customerName: string;
  /** 発行者名。未設定の場合は呼び出し側で事業名を渡す */
  issuerName?: string;
  issuerAddress?: string;
  /** 適格請求書発行事業者の登録番号(T+13桁) */
  registrationNumber?: string;
}) {
  const invoiceNumber = invoice.invoiceNumber ?? invoice.id;
  return (
    <div className="print-sheet mx-auto max-w-3xl border border-zinc-300 bg-white p-8 text-zinc-900 shadow-sm">
      <h1 className="text-center text-xl font-bold tracking-widest">領収書</h1>

      <div className="mt-8">
        <p className="border-b border-zinc-400 pb-1 text-base font-semibold">
          {customerName} 様
        </p>
        <div className="mt-6 flex items-end justify-between">
          <div>
            <p className="text-xs text-zinc-600">領収金額(税込)</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              {formatYen(payment.amount)}
              <span className="ml-1 text-base font-normal">-</span>
            </p>
          </div>
          <div className="h-16 w-16 border border-zinc-400 p-1 text-[10px] text-zinc-400">
            収入印紙
          </div>
        </div>
        <p className="mt-4 text-sm">
          但し　請求書 {invoiceNumber} のご入金として
        </p>
        <p className="mt-4 text-sm">
          上記の金額を領収いたしました。
        </p>
      </div>

      <div className="mt-10 flex items-end justify-between text-sm">
        <div className="text-xs text-zinc-600">
          <p>領収日付 {formatDateJP(payment.date)}</p>
          <p>請求書番号 {invoiceNumber}</p>
        </div>
        <div className="text-right text-xs leading-5">
          {issuerName && <p className="text-sm font-semibold">{issuerName}</p>}
          {issuerAddress && (
            <p className="whitespace-pre-wrap">{issuerAddress}</p>
          )}
          {registrationNumber && <p>登録番号 {registrationNumber}</p>}
        </div>
      </div>
    </div>
  );
}
