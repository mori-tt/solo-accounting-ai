"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { getYearlyReport } from "../actions";
import { callApi } from "@/lib/api-client";
import { fiscalYearOf } from "@/lib/accounting/domain/fiscal";
import type { TaxBucketKey } from "@/lib/accounting/domain/yearly";
import { accountLabel } from "@/lib/accounts";
import { formatDateJP, todayDateString } from "@/lib/format";
import {
  Alert,
  Amount,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  tableClass,
} from "@/components/ui";
import { YearNav } from "../year-nav";

/** 消費税区分の表示名(TaxBucketKey → 帳票向けラベル) */
const TAX_BUCKET_LABELS: Record<TaxBucketKey, string> = {
  taxable_standard: "課税(10%)",
  taxable_reduced: "課税(軽減8%)",
  non_taxable: "非課税",
  exempt: "免税",
  out_of_scope: "不課税(対象外)",
  unclassified: "未分類",
};

const TAX_MODE_LABELS: Record<string, string> = {
  exempt: "免税事業者",
  simple: "簡易課税",
  standard: "本則課税",
};

/** "YYYY-MM" → "YYYY年M月" */
function formatYearMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${Number(y)}年${Number(m)}月`;
}

export function YearlyScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const startMonth = business?.fiscalYearStartMonth ?? 1;

  // null = 未選択(当年度)。事業情報ロード後に開始月で補正される
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const fiscalYear =
    selectedYear ?? fiscalYearOf(todayDateString(), startMonth);

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => getYearlyReport(businessId ?? "", fiscalYear)),
    [businessId, fiscalYear],
  );

  const profit = data
    ? data.report.totalIncome - data.report.totalExpense
    : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="年次レポート"
        description="会計年度範囲の確定済み取引から集計した年間の収支です"
      />

      <div className="mb-4">
        <YearNav
          fiscalYear={fiscalYear}
          startMonth={startMonth}
          onChange={setSelectedYear}
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <p className="mb-4 text-xs text-zinc-500">
            期間: {formatDateJP(data.report.range.startDate)} 〜{" "}
            {formatDateJP(data.report.range.endDate)}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs text-zinc-500">収入合計</p>
              <p className="mt-1 text-2xl font-semibold">
                <Amount value={data.report.totalIncome} />
              </p>
            </Card>
            <Card>
              <p className="text-xs text-zinc-500">支出合計</p>
              <p className="mt-1 text-2xl font-semibold">
                <Amount value={data.report.totalExpense} />
              </p>
            </Card>
            <Card>
              <p className="text-xs text-zinc-500">差引損益</p>
              <p className="mt-1 text-2xl font-semibold">
                <Amount value={profit} colored />
              </p>
            </Card>
          </div>

          <Card className="mt-6">
            <h2 className="mb-3 text-sm font-semibold">月別収支推移</h2>
            {data.report.months.every(
              (m) => m.income === 0 && m.expense === 0,
            ) ? (
              <EmptyState
                title="この年度の確定済み取引がありません"
                description="取引を確定すると月別の推移が表示されます"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th>月</th>
                      <th className="text-right">収入</th>
                      <th className="text-right">支出</th>
                      <th className="text-right">差引</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.report.months.map((m) => (
                      <tr key={m.month}>
                        <td className="whitespace-nowrap">
                          {formatYearMonth(m.month)}
                        </td>
                        <td className="text-right">
                          {m.income > 0 ? <Amount value={m.income} /> : "-"}
                        </td>
                        <td className="text-right">
                          {m.expense > 0 ? <Amount value={m.expense} /> : "-"}
                        </td>
                        <td className="text-right">
                          {m.income > 0 || m.expense > 0 ? (
                            <Amount value={m.income - m.expense} colored />
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-medium">
                      <td>合計</td>
                      <td className="text-right">
                        <Amount value={data.report.totalIncome} />
                      </td>
                      <td className="text-right">
                        <Amount value={data.report.totalExpense} />
                      </td>
                      <td className="text-right">
                        <Amount value={profit} colored />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          <Card className="mt-6">
            <h2 className="mb-3 text-sm font-semibold">科目別年間合計</h2>
            {data.report.accountTotals.length === 0 ? (
              <EmptyState title="集計対象の取引がありません" />
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th>勘定科目</th>
                      <th className="text-right">収入</th>
                      <th className="text-right">支出</th>
                      <th className="text-right">差引</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.report.accountTotals.map((row) => (
                      <tr key={row.account}>
                        <td>{accountLabel(row.account)}</td>
                        <td className="text-right">
                          {row.income > 0 ? (
                            <Amount value={row.income} />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="text-right">
                          {row.expense > 0 ? (
                            <Amount value={row.expense} />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="text-right">
                          <Amount
                            value={row.income - row.expense}
                            colored
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">消費税区分別集計</h2>
              <p className="text-xs text-zinc-400">
                課税方式: {TAX_MODE_LABELS[data.taxMode] ?? data.taxMode}
              </p>
            </div>
            {data.tax.unclassifiedCount > 0 && (
              <Alert tone="warning" className="mb-3">
                消費税区分が未指定の取引が {data.tax.unclassifiedCount}
                件あります。取引の編集から区分を設定できます。
              </Alert>
            )}
            {data.tax.rows.length === 0 ? (
              <EmptyState title="集計対象の取引がありません" />
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th>消費税区分</th>
                      <th className="text-right">収入金額</th>
                      <th className="text-right">うち消費税額</th>
                      <th className="text-right">支出金額</th>
                      <th className="text-right">うち消費税額</th>
                      <th className="text-right">件数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tax.rows.map((row) => (
                      <tr key={row.bucket}>
                        <td>{TAX_BUCKET_LABELS[row.bucket]}</td>
                        <td className="text-right">
                          {row.sales > 0 ? <Amount value={row.sales} /> : "-"}
                        </td>
                        <td className="text-right">
                          {row.salesTax > 0 ? (
                            <Amount value={row.salesTax} />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="text-right">
                          {row.purchases > 0 ? (
                            <Amount value={row.purchases} />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="text-right">
                          {row.purchasesTax > 0 ? (
                            <Amount value={row.purchasesTax} />
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="text-right">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-zinc-400">
              金額は税込。課税取引の税額は内税からの推定値です
              (経費登録で申告済みの消費税額はその額を使います)。
              税率未指定の課税取引は10%として集計します。
            </p>
          </Card>

          {data.taxMode === "simple" ? (
            <Card className="mt-6">
              <h2 className="mb-2 text-sm font-semibold">消費税の申告概算</h2>
              <Alert tone="info">
                簡易課税の概算には事業区分(みなし仕入率)が必要です。
                設定されていないため概算は表示していません。
              </Alert>
            </Card>
          ) : (
            data.taxFiling && (
              <Card className="mt-6">
                <h2 className="mb-3 text-sm font-semibold">
                  消費税の申告概算
                  <span className="ml-2 text-xs font-normal text-zinc-400">
                    {data.taxMode === "exempt"
                      ? "免税事業者"
                      : "本則課税・割戻し方式"}
                  </span>
                </h2>
                {data.taxMode === "exempt" ? (
                  <Alert tone="info">
                    免税事業者のため消費税の納付義務はありません。
                  </Alert>
                ) : (
                  <div className="overflow-x-auto">
                    <table className={tableClass}>
                      <tbody>
                        {data.taxFiling.breakdown.map((b) => (
                          <tr key={b.rate}>
                            <td>
                              課税標準額(
                              {b.rate === "standard" ? "10%" : "軽減8%"})
                            </td>
                            <td className="text-right">
                              <Amount value={b.taxableBase} />
                            </td>
                            <td className="text-right text-xs text-zinc-400">
                              税額 <Amount value={b.nationalTax} />
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td>課税標準額の合計</td>
                          <td className="text-right">
                            <Amount value={data.taxFiling.totalTaxableBase} />
                          </td>
                          <td></td>
                        </tr>
                        <tr>
                          <td>消費税額(国税)</td>
                          <td className="text-right">
                            <Amount value={data.taxFiling.nationalTax} />
                          </td>
                          <td></td>
                        </tr>
                        <tr>
                          <td>控除対象仕入税額</td>
                          <td className="text-right">
                            <Amount
                              value={data.taxFiling.deductibleInputTax}
                            />
                          </td>
                          <td></td>
                        </tr>
                        <tr className="font-medium">
                          <td>納付税額(国税+地方消費税)</td>
                          <td className="text-right">
                            <Amount value={data.taxFiling.totalPayable} />
                          </td>
                          <td className="text-right text-xs text-zinc-400">
                            国税 <Amount value={data.taxFiling.nationalTaxPayable} />
                            {" / "}地方{" "}
                            <Amount value={data.taxFiling.localTaxPayable} />
                          </td>
                        </tr>
                        {data.taxFiling.nationalTaxRefundable > 0 && (
                          <tr>
                            <td>還付税額(概算)</td>
                            <td className="text-right">
                              <Amount
                                value={data.taxFiling.nationalTaxRefundable}
                              />
                            </td>
                            <td></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )
          )}
        </>
      )}
    </div>
  );
}
