import {
  invoiceAmountsByRate,
  invoiceTaxAmount,
} from "@/lib/accounting/invoice-tax";
import type { ConsumptionTaxRate } from "@/lib/accounting/domain/tax";
import type { Quote } from "@/lib/accounting/types";
import { formatDateJP, formatYen } from "@/lib/format";

const RATE_LABELS: Record<ConsumptionTaxRate, string> = {
  standard: "10%",
  reduced: "軽減8%",
};

/**
 * 見積書の帳票レイアウト。画面プレビューと印刷(@media print)の両方で使う。
 * 請求書と同じ明細構造のため税率別内訳の算出は invoice-tax を共有する。
 */
export function QuoteSheet({
  quote,
  customerName,
  customerAddress,
  projectName,
  issuerName,
  issuerAddress,
  registrationNumber,
}: {
  quote: Quote;
  customerName: string;
  customerAddress?: string;
  projectName?: string;
  /** 発行者名。未設定の場合は呼び出し側で事業名を渡す */
  issuerName?: string;
  issuerAddress?: string;
  /** 適格請求書発行事業者の登録番号(T+13桁) */
  registrationNumber?: string;
}) {
  const rateGroups = invoiceAmountsByRate(quote);
  return (
    <div className="print-sheet mx-auto max-w-3xl border border-zinc-300 bg-white p-8 text-zinc-900 shadow-sm">
      <h1 className="text-center text-xl font-bold tracking-widest">見積書</h1>
      {quote.status === "draft" && (
        <p className="mt-1 text-center text-xs text-zinc-400">(下書き)</p>
      )}

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
            下記のとおりお見積もり申し上げます。
          </p>
        </div>
        <div className="shrink-0 text-right text-xs leading-5">
          {issuerName && <p className="text-sm font-semibold">{issuerName}</p>}
          {issuerAddress && (
            <p className="whitespace-pre-wrap">{issuerAddress}</p>
          )}
          {registrationNumber && <p>登録番号 {registrationNumber}</p>}
        </div>
      </div>

      <div className="mt-2 flex gap-6 text-xs text-zinc-600">
        <span>見積番号 {quote.quoteNumber ?? quote.id}</span>
        <span>発行日 {formatDateJP(quote.issueDate)}</span>
        <span>有効期限 {formatDateJP(quote.validUntil)}</span>
      </div>

      <table className="print-table mt-4 w-full border-collapse text-sm [&_td]:border [&_td]:border-zinc-400 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-zinc-400 [&_th]:px-2 [&_th]:py-1">
        <thead>
          <tr className="bg-zinc-100">
            <th className="text-left font-medium">品目</th>
            <th className="w-16 text-right font-medium">数量</th>
            <th className="w-28 text-right font-medium">単価</th>
            <th className="w-20 text-center font-medium">税率</th>
            <th className="w-28 text-right font-medium">金額</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((item, i) => {
            const rate = item.taxRate ?? "standard";
            return (
              <tr key={i}>
                <td>
                  {item.description}
                  {rate === "reduced" && (
                    <span className="ml-1 text-zinc-500">※</span>
                  )}
                </td>
                <td className="text-right tabular-nums">{item.quantity}</td>
                <td className="text-right tabular-nums">
                  {formatYen(item.unitPrice)}
                </td>
                <td className="text-center">{RATE_LABELS[rate]}</td>
                <td className="text-right tabular-nums">
                  {formatYen(item.amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="text-right font-semibold">
              合計(税込)
            </td>
            <td className="text-right font-semibold tabular-nums">
              {formatYen(quote.totalAmount)}
            </td>
          </tr>
        </tfoot>
      </table>
      {quote.items.some(
        (i) => (i.taxRate ?? "standard") === "reduced",
      ) && (
        <p className="mt-1 text-[10px] text-zinc-500">
          ※ 軽減税率対象品目
        </p>
      )}

      <table className="mt-4 w-full border-collapse text-xs [&_td]:border [&_td]:border-zinc-400 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-zinc-400 [&_th]:px-2 [&_th]:py-1">
        <thead>
          <tr className="bg-zinc-100">
            <th className="text-left font-medium">内訳</th>
            <th className="text-right font-medium">対象金額(税込)</th>
            <th className="text-right font-medium">消費税額</th>
          </tr>
        </thead>
        <tbody>
          {rateGroups.map((g) => (
            <tr key={g.rate}>
              <td>{RATE_LABELS[g.rate]}対象</td>
              <td className="text-right tabular-nums">
                {formatYen(g.amount)}
              </td>
              <td className="text-right tabular-nums">
                {formatYen(g.taxAmount)}
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td>消費税合計</td>
            <td className="text-right tabular-nums">-</td>
            <td className="text-right tabular-nums">
              {formatYen(invoiceTaxAmount(quote))}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-4 text-right text-lg font-bold">
        お見積金額{" "}
        <span className="tabular-nums">{formatYen(quote.totalAmount)}</span>
        <span className="ml-1 text-xs font-normal">(税込)</span>
      </p>

      {quote.notes && (
        <div className="mt-6 text-xs text-zinc-700">
          <p className="font-medium">備考</p>
          <p className="mt-1 whitespace-pre-wrap">{quote.notes}</p>
        </div>
      )}

      <p className="mt-6 text-[10px] text-zinc-400">
        ※ 金額はすべて税込表示です。消費税額は明細ごとの内税を切り捨てで
        算出した合算値です。本見積の有効期限は記載のとおりです。
      </p>
    </div>
  );
}
