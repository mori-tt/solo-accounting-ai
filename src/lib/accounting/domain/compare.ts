import type { YearlyReport } from "./yearly";

/**
 * 複数年比較集計(複数年比較レポート)。
 * buildYearlyReport の結果を年度(古い順)に並べ、
 * 年間合計・月別の各指標(売上/経費/利益)について対前年増減率を付ける。
 * 対象は年次集計と同じく確定済み(confirmed/locked)の income/expense 取引のみ。
 */

/** 比較する指標 */
export type ComparisonMetric = "income" | "expense" | "profit";

/** 1指標の年度別値と対前年増減率 */
export interface ComparisonValues {
  /** 年度(古い順)ごとの金額(円・整数) */
  amounts: number[];
  /**
   * 年度(古い順)ごとの対前年増減率(%)。
   * 先頭年と、前年側が0以下(0円・赤字)で率を定義できない年は null。
   */
  yoyRates: (number | null)[];
}

/** 月別比較行。month は暦月(1-12)で、年度内の並びは会計年度開始月順 */
export interface MonthlyComparison {
  month: number;
  income: ComparisonValues;
  expense: ComparisonValues;
  profit: ComparisonValues;
}

export interface YearComparison {
  /** 比較対象の会計年度(古い順) */
  fiscalYears: number[];
  /** 年間合計の指標別比較 */
  annual: Record<ComparisonMetric, ComparisonValues>;
  /** 月別の指標別比較(最新年の会計年度順・12行) */
  monthly: MonthlyComparison[];
}

/**
 * 対前年増減率(%)。previous が0以下のとき率は意味を持たない
 * (0→0 は±0%、0→正は無限大、負→正負の混在)ため null を返す。
 */
export function yoyRate(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * 年次レポート群から複数年比較を組み立てる。
 * reports は同じ fiscalYearStartMonth で buildYearlyReport したものを渡す
 * (months が年度内順で揃う前提。年度順はソートするため入力順は問わない)。
 */
export function buildYearComparison(
  reports: readonly YearlyReport[],
): YearComparison {
  const years = [...reports].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const fiscalYears = years.map((r) => r.fiscalYear);

  const values = (amounts: number[]): ComparisonValues => ({
    amounts,
    yoyRates: amounts.map((amount, i) =>
      i === 0 ? null : yoyRate(amount, amounts[i - 1]),
    ),
  });

  const annual: Record<ComparisonMetric, ComparisonValues> = {
    income: values(years.map((r) => r.totalIncome)),
    expense: values(years.map((r) => r.totalExpense)),
    profit: values(years.map((r) => r.totalIncome - r.totalExpense)),
  };

  // 最新年の months(会計年度順)を基準に月行を並べる。
  // 同じ開始月で組み立てた各年の months[i] は同じ暦月を指す
  const latest = years[years.length - 1];
  const monthly: MonthlyComparison[] = (latest?.months ?? []).map((m, i) => {
    const month = Number(m.month.slice(5, 7));
    const monthOf = (r: YearlyReport) => r.months[i];
    return {
      month,
      income: values(years.map((r) => monthOf(r)?.income ?? 0)),
      expense: values(years.map((r) => monthOf(r)?.expense ?? 0)),
      profit: values(
        years.map((r) => (monthOf(r)?.income ?? 0) - (monthOf(r)?.expense ?? 0)),
      ),
    };
  });

  return { fiscalYears, annual, monthly };
}
