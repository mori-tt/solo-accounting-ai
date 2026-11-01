import { accountLabel } from "@/lib/accounts";
import type {
  IncomeStatement,
  NetIncomeResult,
} from "@/lib/accounting/domain/filing";
import { formatDateJP, formatYen } from "@/lib/format";

/**
 * 収支内訳書(一般用)の様式風レイアウトで年間収支を表示する帳票。
 * 画面プレビューと印刷(@media print)の両方で使う。
 * 公式様式の転記用資料であり、e-Tax提出用フォーマットそのものではない。
 */
export function FilingSheet({
  businessName,
  statement,
  result,
}: {
  businessName: string;
  statement: IncomeStatement;
  result: NetIncomeResult & { familyEmployeeSalary: number };
}) {
  return (
    <div className="print-sheet mx-auto max-w-3xl border border-zinc-300 bg-white p-8 text-zinc-900 shadow-sm">
      <h1 className="text-center text-lg font-bold tracking-wide">
        収支内訳書(一般用)
      </h1>
      <div className="mt-4 flex items-end justify-between text-xs">
        <span>{businessName}</span>
        <span>
          自 {formatDateJP(statement.range.startDate)} 至{" "}
          {formatDateJP(statement.range.endDate)}
        </span>
      </div>

      <table className="mt-2 w-full border-collapse text-sm [&_td]:border [&_td]:border-zinc-400 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-zinc-400 [&_th]:px-2 [&_th]:py-1">
        <thead>
          <tr className="bg-zinc-100">
            <th className="w-3/4 text-left font-medium">科目</th>
            <th className="text-right font-medium">金額</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-zinc-50">
            <td colSpan={2} className="text-xs font-semibold">
              収入金額
            </td>
          </tr>
          {statement.incomeRows.length === 0 ? (
            <tr>
              <td className="text-zinc-400">(収入なし)</td>
              <td className="text-right">-</td>
            </tr>
          ) : (
            statement.incomeRows.map((row) => (
              <tr key={row.account}>
                <td className="pl-4">
                  {row.account === "sales"
                    ? "売上(収入)金額"
                    : accountLabel(row.account)}
                </td>
                <td className="text-right tabular-nums">
                  {formatYen(row.amount)}
                </td>
              </tr>
            ))
          )}
          <tr className="font-medium">
            <td>収入金額 計</td>
            <td className="text-right tabular-nums">
              {formatYen(statement.totalIncome)}
            </td>
          </tr>

          <tr className="bg-zinc-50">
            <td colSpan={2} className="text-xs font-semibold">
              売上原価
            </td>
          </tr>
          <tr>
            <td className="pl-4">期首商品(製品)棚卸高</td>
            <td className="text-right tabular-nums">{formatYen(0)}</td>
          </tr>
          {statement.purchaseRows.length === 0 ? (
            <tr>
              <td className="pl-4 text-zinc-400">仕入金額(製品の仕入等)</td>
              <td className="text-right">-</td>
            </tr>
          ) : (
            statement.purchaseRows.map((row) => (
              <tr key={row.account}>
                <td className="pl-4">仕入金額({accountLabel(row.account)})</td>
                <td className="text-right tabular-nums">
                  {formatYen(row.amount)}
                </td>
              </tr>
            ))
          )}
          <tr>
            <td className="pl-4">期末商品(製品)棚卸高</td>
            <td className="text-right tabular-nums">{formatYen(0)}</td>
          </tr>
          <tr className="font-medium">
            <td>差引原価</td>
            <td className="text-right tabular-nums">
              {formatYen(statement.totalPurchases)}
            </td>
          </tr>

          <tr className="bg-zinc-50">
            <td colSpan={2} className="text-xs font-semibold">
              経費
            </td>
          </tr>
          {statement.expenseRows.length === 0 ? (
            <tr>
              <td className="pl-4 text-zinc-400">(経費なし)</td>
              <td className="text-right">-</td>
            </tr>
          ) : (
            statement.expenseRows.map((row) => (
              <tr key={row.account}>
                <td className="pl-4">{accountLabel(row.account)}</td>
                <td className="text-right tabular-nums">
                  {formatYen(row.amount)}
                </td>
              </tr>
            ))
          )}
          <tr className="font-medium">
            <td>経費 計</td>
            <td className="text-right tabular-nums">
              {formatYen(statement.totalExpenses)}
            </td>
          </tr>

          <tr className="bg-zinc-100 font-semibold">
            <td>差引金額(収入金額 - 売上原価 - 経費)</td>
            <td className="text-right tabular-nums">
              {formatYen(statement.grossIncome)}
            </td>
          </tr>
          <tr>
            <td>専従者給与</td>
            <td className="text-right tabular-nums">
              {formatYen(result.familyEmployeeSalary)}
            </td>
          </tr>
          <tr>
            <td>青色申告特別控除額</td>
            <td className="text-right tabular-nums">
              {formatYen(result.appliedDeduction)}
            </td>
          </tr>
          <tr className="bg-zinc-100 font-semibold">
            <td>所得金額</td>
            <td className="text-right tabular-nums">
              {formatYen(result.netIncome)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-3 text-[10px] text-zinc-400">
        ※ 本帳票は収支内訳書(一般用)の様式を参考にした転記用の内部資料です。
        棚卸高・青色申告特別控除は手入力値で、確定データには保存されません。
        専従者給与は専従者給与科目の年間合計を初期表示し、画面上で上書きできます。
      </p>
    </div>
  );
}
