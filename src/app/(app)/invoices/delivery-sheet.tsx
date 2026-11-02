import type { Invoice } from "@/lib/accounting/types";
import { formatDateJP } from "@/lib/format";

/**
 * 納品書の帳票レイアウト。請求書の明細をベースに、
 * 単価・金額・税率・合計を一切出さない「金額を見せない」様式。
 * 納品書番号は採番せず請求書番号から派生させる({invoiceNumber}-D)。
 */
export function DeliverySheet({
  invoice,
  customerName,
  customerAddress,
  projectName,
  issuerName,
  issuerAddress,
}: {
  invoice: Invoice;
  customerName: string;
  customerAddress?: string;
  projectName?: string;
  /** 発行者名。未設定の場合は呼び出し側で事業名を渡す */
  issuerName?: string;
  issuerAddress?: string;
}) {
  const invoiceNumber = invoice.invoiceNumber ?? invoice.id;
  return (
    <div className="print-sheet mx-auto max-w-3xl border border-zinc-300 bg-white p-8 text-zinc-900 shadow-sm">
      <h1 className="text-center text-xl font-bold tracking-widest">納品書</h1>

      <div className="mt-6 flex items-start justify-between gap-8 text-sm">
        <div>
          <p className="border-b border-zinc-400 pb-1 text-base font-semibold">
            {customerName} 御中
          </p>
          {customerAddress && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600">
              {customerAddress}
            </p>
          )}
          {projectName && (
            <p className="mt-1 text-xs text-zinc-600">案件: {projectName}</p>
          )}
          <p className="mt-4 text-sm">
            下記のとおり納品いたしました。
          </p>
        </div>
        <div className="shrink-0 text-right text-xs leading-5">
          {issuerName && <p className="text-sm font-semibold">{issuerName}</p>}
          {issuerAddress && (
            <p className="whitespace-pre-wrap">{issuerAddress}</p>
          )}
        </div>
      </div>

      <div className="mt-2 flex gap-6 text-xs text-zinc-600">
        <span>納品書番号 {invoiceNumber}-D</span>
        <span>納品日 {formatDateJP(invoice.issueDate)}</span>
        <span>請求書番号 {invoiceNumber}</span>
      </div>

      <table className="print-table mt-4 w-full border-collapse text-sm [&_td]:border [&_td]:border-zinc-400 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-zinc-400 [&_th]:px-2 [&_th]:py-1">
        <thead>
          <tr className="bg-zinc-100">
            <th className="w-10 text-center font-medium">No.</th>
            <th className="text-left font-medium">品目</th>
            <th className="w-24 text-right font-medium">数量</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, i) => (
            <tr key={i}>
              <td className="text-center tabular-nums">{i + 1}</td>
              <td>{item.description}</td>
              <td className="text-right tabular-nums">{item.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-6 text-[10px] text-zinc-400">
        ※ 本書は納品内容の確認用です。ご請求金額は請求書
        {invoiceNumber} をご確認ください。
      </p>
    </div>
  );
}
