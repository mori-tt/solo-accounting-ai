import { pad2, yearMonthOf, type YearMonth } from "./dates";
import { fiscalPeriodRange, type DateRange } from "./fiscal";
import { addYen } from "./money";
import {
  computeTaxAmount,
  type ConsumptionTaxRate,
  type FilingTaxableAmounts,
} from "./tax";
import type { TransactionStatus, TransactionType } from "./types";

/**
 * 会計年度単位の集計(年次レポート・消費税区分集計)。
 * 月次集計(summary.ts)と同じく、確定済み(confirmed/locked)の
 * income/expense 取引のみを対象とし、draft と transfer は除く。
 */

/**
 * 取引の消費税区分。services 層の TaxCategory(snake_case)と同じ値。
 * domain/types.ts の同名型は旧世代の camelCase 値のため別名で定義する。
 */
export type TransactionTaxCategory =
  | "taxable"
  | "non_taxable"
  | "exempt"
  | "out_of_scope";

/** 年次集計に必要な取引項目 */
export interface YearlyTransaction {
  id: string;
  type: TransactionType;
  date: string;
  amount: number;
  account: string;
  status: TransactionStatus;
  /** 消費税区分。未設定は未分類として集計する */
  taxCategory?: TransactionTaxCategory;
  /** 税率区分。taxable のときのみ有効(省略時 standard) */
  taxRate?: ConsumptionTaxRate;
}

/** 月別収支行 */
export interface YearlyMonthRow {
  /** "YYYY-MM" */
  month: YearMonth;
  income: number;
  expense: number;
}

/** 科目別の年間合計行 */
export interface YearlyAccountRow {
  account: string;
  income: number;
  expense: number;
}

export interface YearlyReport {
  fiscalYear: number;
  /** 会計年度の期間範囲 */
  range: DateRange;
  /** 会計年度開始月から12か月分(年度内順) */
  months: YearlyMonthRow[];
  /** 科目別の年間合計(科目コード昇順) */
  accountTotals: YearlyAccountRow[];
  totalIncome: number;
  totalExpense: number;
}

/**
 * 会計年度範囲の年次集計を組み立てる。
 * transactions は期間内外どちらも含んでよい(期間外は自動で除外される)。
 */
export function buildYearlyReport(
  transactions: readonly YearlyTransaction[],
  fiscalYear: number,
  fiscalYearStartMonth: number,
): YearlyReport {
  const range = fiscalPeriodRange(fiscalYear, fiscalYearStartMonth);

  const months: YearlyMonthRow[] = [];
  const byMonth = new Map<YearMonth, YearlyMonthRow>();
  let year = fiscalYear;
  let month = fiscalYearStartMonth;
  for (let i = 0; i < 12; i++) {
    const key = `${year}-${pad2(month)}` as YearMonth;
    const row: YearlyMonthRow = { month: key, income: 0, expense: 0 };
    months.push(row);
    byMonth.set(key, row);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const byAccount = new Map<string, { income: number; expense: number }>();
  let totalIncome = 0;
  let totalExpense = 0;
  for (const t of transactions) {
    if (t.status !== "confirmed" && t.status !== "locked") continue;
    if (t.type !== "income" && t.type !== "expense") continue;
    const monthRow = byMonth.get(yearMonthOf(t.date));
    if (!monthRow) continue;
    const acc = byAccount.get(t.account) ?? { income: 0, expense: 0 };
    if (t.type === "income") {
      monthRow.income = addYen(monthRow.income, t.amount);
      acc.income = addYen(acc.income, t.amount);
      totalIncome = addYen(totalIncome, t.amount);
    } else {
      monthRow.expense = addYen(monthRow.expense, t.amount);
      acc.expense = addYen(acc.expense, t.amount);
      totalExpense = addYen(totalExpense, t.amount);
    }
    byAccount.set(t.account, acc);
  }

  const accountTotals = [...byAccount.entries()]
    .map(([account, v]) => ({
      account,
      income: v.income,
      expense: v.expense,
    }))
    .sort((a, b) => a.account.localeCompare(b.account));

  return {
    fiscalYear,
    range,
    months,
    accountTotals,
    totalIncome,
    totalExpense,
  };
}

/* ------------------------------------------------------------------ */
/* 消費税区分別集計                                                     */
/* ------------------------------------------------------------------ */

/**
 * Expense 側に保持される税情報。
 * 経費登録で作られた取引は Transaction 側に税区分を持たないため、
 * 紐付く Expense の taxCategory/taxAmount を集計に使う。
 */
export interface ExpenseTaxRecord {
  transactionId: string;
  taxCategory: TransactionTaxCategory;
  /** 申告済み消費税額(円・整数)。0の場合は金額からの推定にフォールバック */
  taxAmount: number;
}

/** 集計表の区分キー。課税は税率別に分ける */
export type TaxBucketKey =
  | "taxable_standard"
  | "taxable_reduced"
  | "non_taxable"
  | "exempt"
  | "out_of_scope"
  | "unclassified";

export const TAX_BUCKET_ORDER: readonly TaxBucketKey[] = [
  "taxable_standard",
  "taxable_reduced",
  "non_taxable",
  "exempt",
  "out_of_scope",
  "unclassified",
];

export interface ConsumptionTaxRow {
  bucket: TaxBucketKey;
  /** 収入(income)側の金額合計(円・税込前提) */
  sales: number;
  /** 支出(expense)側の金額合計(円・税込前提) */
  purchases: number;
  /** 収入側の消費税額。課税は税込金額からの推定、その他区分は0 */
  salesTax: number;
  /**
   * 支出側の消費税額。Expense.taxAmount の申告額を優先し、
   * 未設定(0)なら課税区分の内税推定、その他区分は0。
   */
  purchasesTax: number;
  /** 集計対象の取引件数 */
  count: number;
}

export interface ConsumptionTaxSummary {
  /** 区分別集計。課税(率別)・非課税・免税・不課税は常に行を返す */
  rows: ConsumptionTaxRow[];
  /**
   * computeConsumptionTaxFiling への入力。
   * 課税売上・課税仕入の税率別合計(税込)。税率未指定の課税は standard に含める。
   */
  filingAmounts: FilingTaxableAmounts[];
  /** taxCategory 未設定の集計対象取引件数 */
  unclassifiedCount: number;
}

function bucketOf(
  taxCategory: TransactionTaxCategory | undefined,
  taxRate: ConsumptionTaxRate | undefined,
): TaxBucketKey {
  switch (taxCategory) {
    case "taxable":
      return taxRate === "reduced" ? "taxable_reduced" : "taxable_standard";
    case "non_taxable":
      return "non_taxable";
    case "exempt":
      return "exempt";
    case "out_of_scope":
      return "out_of_scope";
    default:
      return "unclassified";
  }
}

/**
 * 消費税区分別の集計を組み立てる。
 * 対象は確定済みの income/expense 取引。区分は取引自身の taxCategory を
 * 優先し、無ければ紐付く Expense の区分を使う(両方無ければ未分類)。
 * 金額は税込前提のため、課税取引の税額は内税計算(computeTaxAmount)で推定する。
 */
export function buildConsumptionTaxSummary(
  transactions: readonly YearlyTransaction[],
  expenseTaxes: readonly ExpenseTaxRecord[],
): ConsumptionTaxSummary {
  const expenseByTx = new Map(expenseTaxes.map((e) => [e.transactionId, e]));

  const rows = new Map<TaxBucketKey, ConsumptionTaxRow>();
  const rowFor = (bucket: TaxBucketKey): ConsumptionTaxRow => {
    let row = rows.get(bucket);
    if (!row) {
      row = {
        bucket,
        sales: 0,
        purchases: 0,
        salesTax: 0,
        purchasesTax: 0,
        count: 0,
      };
      rows.set(bucket, row);
    }
    return row;
  };

  const filingSales = new Map<ConsumptionTaxRate, number>();
  const filingPurchases = new Map<ConsumptionTaxRate, number>();
  let unclassifiedCount = 0;

  for (const t of transactions) {
    if (t.status !== "confirmed" && t.status !== "locked") continue;
    if (t.type !== "income" && t.type !== "expense") continue;

    const expense = expenseByTx.get(t.id);
    const category = t.taxCategory ?? expense?.taxCategory;
    const bucket = bucketOf(category, t.taxRate);
    const row = rowFor(bucket);
    row.count += 1;

    if (category === "taxable") {
      // 税率未指定(Expense由来等)は standard として集計する
      const rate: ConsumptionTaxRate = t.taxRate ?? "standard";
      if (t.type === "income") {
        row.sales = addYen(row.sales, t.amount);
        row.salesTax = addYen(
          row.salesTax,
          computeTaxAmount(t.amount, { basis: "inclusive", rate }),
        );
        filingSales.set(rate, addYen(filingSales.get(rate) ?? 0, t.amount));
      } else {
        row.purchases = addYen(row.purchases, t.amount);
        const declared = expense?.taxAmount ?? 0;
        row.purchasesTax = addYen(
          row.purchasesTax,
          declared > 0
            ? declared
            : computeTaxAmount(t.amount, { basis: "inclusive", rate }),
        );
        filingPurchases.set(
          rate,
          addYen(filingPurchases.get(rate) ?? 0, t.amount),
        );
      }
    } else {
      if (t.type === "income") {
        row.sales = addYen(row.sales, t.amount);
      } else {
        row.purchases = addYen(row.purchases, t.amount);
      }
      if (bucket === "unclassified") unclassifiedCount += 1;
    }
  }

  const filingAmounts: FilingTaxableAmounts[] = [];
  for (const rate of ["standard", "reduced"] as const) {
    const salesYen = filingSales.get(rate) ?? 0;
    const purchasesYen = filingPurchases.get(rate) ?? 0;
    if (salesYen > 0 || purchasesYen > 0) {
      filingAmounts.push({ rate, salesYen, purchasesYen });
    }
  }

  const orderedRows = TAX_BUCKET_ORDER.map((bucket) => rows.get(bucket))
    .filter((r): r is ConsumptionTaxRow => r !== undefined)
    .filter((r) => r.bucket !== "unclassified" || r.count > 0);

  return { rows: orderedRows, filingAmounts, unclassifiedCount };
}
