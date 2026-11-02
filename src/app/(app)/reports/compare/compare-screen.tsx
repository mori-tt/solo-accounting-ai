"use client";

import { Fragment, useState, type ReactNode } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { getYearComparisonReport } from "../actions";
import { callApi } from "@/lib/api-client";
import { fiscalYearOf } from "@/lib/accounting/domain/fiscal";
import type {
  ComparisonMetric,
  ComparisonValues,
} from "@/lib/accounting/domain/compare";
import { todayDateString } from "@/lib/format";
import {
  Amount,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  tableClass,
} from "@/components/ui";
import { YearNav } from "../year-nav";
import { PrintHeader } from "../print-header";

type ViewMode = "monthly" | "annual";

const METRIC_LABELS: Record<ComparisonMetric, string> = {
  income: "売上",
  expense: "経費",
  profit: "利益",
};

/** 対前年増減率のセル表示。null(前年0円・赤字で率を定義できない)は「-」 */
function YoYRate({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-zinc-400">-</span>;
  const rounded = Math.round(rate * 10) / 10;
  const tone =
    rounded > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : rounded < 0
        ? "text-red-600 dark:text-red-400"
        : "";
  return (
    <span className={`tabular-nums ${tone}`}>
      {rounded > 0 ? "+" : ""}
      {rounded.toFixed(1)}%
    </span>
  );
}

/** 選択肢トグル(ログイン画面の signin/signup 切替と同じ見た目) */
function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`flex-1 rounded px-3 py-1.5 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-indigo-500 ${
            value === v
              ? "bg-white font-medium shadow-sm dark:bg-zinc-900"
              : "text-zinc-500"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** 年度列ヘッダ。2年目以降の列には前年比列を隣接させる */
function YearColumns({ fiscalYears }: { fiscalYears: number[] }) {
  return (
    <>
      {fiscalYears.map((fy, i) => (
        <Fragment key={fy}>
          <th className="text-right whitespace-nowrap">{fy}年度</th>
          {i > 0 && <th className="text-right whitespace-nowrap">前年比</th>}
        </Fragment>
      ))}
    </>
  );
}

/** 1行分: ラベル + 各年の金額セル + 前年比セル */
function ComparisonRow({
  label,
  values,
  colored = false,
  className = "",
}: {
  label: ReactNode;
  values: ComparisonValues;
  /** 金額を損益色分けするか(利益行) */
  colored?: boolean;
  className?: string;
}) {
  return (
    <tr className={className}>
      <td className="whitespace-nowrap">{label}</td>
      {values.amounts.map((amount, i) => (
        <Fragment key={i}>
          <td className="text-right">
            {amount !== 0 ? <Amount value={amount} colored={colored} /> : "-"}
          </td>
          {i > 0 && (
            <td className="text-right">
              <YoYRate rate={values.yoyRates[i]} />
            </td>
          )}
        </Fragment>
      ))}
    </tr>
  );
}

export function CompareScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const startMonth = business?.fiscalYearStartMonth ?? 1;

  // null = 未選択(当年度)。事業情報ロード後に開始月で補正される
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>("monthly");
  const [metric, setMetric] = useState<ComparisonMetric>("income");
  const fiscalYear =
    selectedYear ?? fiscalYearOf(todayDateString(), startMonth);

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => getYearComparisonReport(businessId ?? "", fiscalYear)),
    [businessId, fiscalYear],
  );

  const years = data?.comparison.fiscalYears ?? [];
  const isEmpty =
    data !== undefined &&
    data.comparison.annual.income.amounts.every((a) => a === 0) &&
    data.comparison.annual.expense.amounts.every((a) => a === 0);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print">
        <PageHeader
          title="複数年比較レポート"
          description="選択年度と前2年度の確定済み取引から売上・経費・利益を比較します"
          actions={
            <Button
              variant="secondary"
              onClick={() => window.print()}
              disabled={!data || isEmpty}
            >
              印刷する
            </Button>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <YearNav
            fiscalYear={fiscalYear}
            startMonth={startMonth}
            onChange={setSelectedYear}
          />
          <Toggle
            options={[
              ["monthly", "月次比較"],
              ["annual", "年次比較"],
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === "monthly" && (
            <Toggle
              options={(
                ["income", "expense", "profit"] as const
              ).map((m) => [m, METRIC_LABELS[m]] as const)}
              value={metric}
              onChange={setMetric}
            />
          )}
        </div>
      </div>

      {error ? (
        <div className="no-print">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : initialLoading ? (
        <div className="no-print">
          <LoadingBlock />
        </div>
      ) : !data ? (
        <div className="no-print">
          <ErrorState onRetry={reload} />
        </div>
      ) : isEmpty ? (
        <div className="no-print">
          <EmptyState
            title="比較対象の確定済み取引がありません"
            description={`${years[0]}年度〜${years[years.length - 1]}年度に確定済みの取引がないため比較できません`}
          />
        </div>
      ) : (
        <>
          <PrintHeader
            title="複数年比較レポート"
            period={`${years[0]}年度〜${years[years.length - 1]}年度`}
            businessName={business?.name}
          />
          <Card className="print-sheet">
            <h2 className="mb-3 text-sm font-semibold">
              {mode === "monthly"
                ? `月別の${METRIC_LABELS[metric]}推移(${years[0]}年度〜${years[years.length - 1]}年度)`
                : `年間収支の比較(${years[0]}年度〜${years[years.length - 1]}年度)`}
            </h2>
            {mode === "monthly" ? (
              <div className="overflow-x-auto">
                <table className={`${tableClass} print-table`}>
                  <thead>
                    <tr>
                      <th>月</th>
                      <YearColumns fiscalYears={years} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.comparison.monthly.map((row) => (
                      <ComparisonRow
                        key={row.month}
                        label={`${row.month}月`}
                        values={row[metric]}
                        colored={metric === "profit"}
                      />
                    ))}
                  </tbody>
                  <tfoot>
                    <ComparisonRow
                      label="合計"
                      values={data.comparison.annual[metric]}
                      colored={metric === "profit"}
                      className="font-medium"
                    />
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className={`${tableClass} print-table`}>
                  <thead>
                    <tr>
                      <th>指標</th>
                      <YearColumns fiscalYears={years} />
                    </tr>
                  </thead>
                  <tbody>
                    {(["income", "expense", "profit"] as const).map((m) => (
                      <ComparisonRow
                        key={m}
                        label={METRIC_LABELS[m]}
                        values={data.comparison.annual[m]}
                        colored={m === "profit"}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-zinc-400">
              前年比は{mode === "monthly" ? "前年度同月" : "前年度"}
              に対する増減率です。前年度が0円または赤字(利益)の場合は
              「-」と表示します。金額は確定済み取引の税込合計です。
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
