import { DomainError } from "./errors";
import { isIntegerYen } from "./money";
import type { DateRange } from "./fiscal";
import type { YearlyReport } from "./yearly";

/**
 * 収支内訳書(一般用)向けの年間収支組み立て。
 * 科目別の年間合計(YearlyReport.accountTotals)を
 * 「収入金額 / 売上原価 / 経費 / 差引金額 / 専従者給与 /
 * 青色申告特別控除 / 所得金額」の様式に対応づける。
 */

/** 売上原価として扱う仕入科目コード(accounts.ts の "purchases" に対応) */
export const PURCHASES_ACCOUNT = "purchases";

/**
 * 専従者給与として扱う科目コード(accounts.ts の "family_salary" に対応)。
 * 収支内訳書では経費ではなく差引金額の下の専用欄へ記載するため、
 * この科目の支出は経費部から分離して専従者給与欄の初期値にする。
 */
export const FAMILY_SALARY_ACCOUNT = "family_salary";

/** 青色申告特別控除の上限額(65万円) */
export const BLUE_RETURN_DEDUCTION_MAX = 650_000;

/** 帳票の科目別内訳行 */
export interface StatementRow {
  account: string;
  /** 年間合計(円・整数) */
  amount: number;
}

export interface IncomeStatement {
  fiscalYear: number;
  range: DateRange;
  /** 収入金額の内訳(科目コード昇順) */
  incomeRows: StatementRow[];
  /** 収入金額 計 */
  totalIncome: number;
  /** 売上原価の内訳(仕入科目) */
  purchaseRows: StatementRow[];
  /** 売上原価 計 */
  totalPurchases: number;
  /** 経費の内訳(仕入・専従者給与以外の支出科目) */
  expenseRows: StatementRow[];
  /** 経費 計 */
  totalExpenses: number;
  /** 差引金額 = 収入金額 - 売上原価 - 経費(赤字は負数) */
  grossIncome: number;
  /**
   * 専従者給与欄の初期値 = family_salary 科目の年間支出合計。
   * 経費部には含めない(専用欄で差し引くため二重計上を防ぐ)。
   */
  familyEmployeeSalary: number;
}

/**
 * 年次集計から収支内訳書の収支部分を組み立てる。
 * 支出科目のうち仕入高(purchases)は売上原価、専従者給与(family_salary)は
 * 専用欄の初期値、その他は経費に振り分ける。
 */
export function buildIncomeStatement(report: YearlyReport): IncomeStatement {
  const incomeRows: StatementRow[] = [];
  const purchaseRows: StatementRow[] = [];
  const expenseRows: StatementRow[] = [];
  let totalIncome = 0;
  let totalPurchases = 0;
  let totalExpenses = 0;
  let familyEmployeeSalary = 0;

  for (const row of report.accountTotals) {
    if (row.income > 0) {
      incomeRows.push({ account: row.account, amount: row.income });
      totalIncome += row.income;
    }
    if (row.expense > 0) {
      if (row.account === PURCHASES_ACCOUNT) {
        purchaseRows.push({ account: row.account, amount: row.expense });
        totalPurchases += row.expense;
      } else if (row.account === FAMILY_SALARY_ACCOUNT) {
        familyEmployeeSalary += row.expense;
      } else {
        expenseRows.push({ account: row.account, amount: row.expense });
        totalExpenses += row.expense;
      }
    }
  }

  return {
    fiscalYear: report.fiscalYear,
    range: report.range,
    incomeRows,
    totalIncome,
    purchaseRows,
    totalPurchases,
    expenseRows,
    totalExpenses,
    grossIncome: totalIncome - totalPurchases - totalExpenses,
    familyEmployeeSalary,
  };
}

export interface NetIncomeInput {
  /** 差引金額(円・整数。赤字は負数) */
  grossIncome: number;
  /** 専従者給与(円・整数・0以上) */
  familyEmployeeSalary?: number;
  /** 青色申告特別控除の入力額(円・整数・0〜65万) */
  blueReturnDeduction?: number;
}

export interface NetIncomeResult {
  /** 差引金額 - 専従者給与(負の場合もある) */
  incomeAfterFamilySalary: number;
  /** 実際に適用された青色申告特別控除額(所得を上限に切り詰め) */
  appliedDeduction: number;
  /** 所得金額(0未満にはならない) */
  netIncome: number;
}

/**
 * 差引金額から専従者給与・青色申告特別控除を差し引いて所得金額を求める。
 * - 専従者給与は全額差し引く(所得が負になり得る)
 * - 青色申告特別控除は「差引金額 - 専従者給与」を上限に適用し、
 *   所得金額が0未満にはならない(収支内訳書の控除ルール)
 * - 控除の入力上限は65万円
 */
export function computeNetIncome(input: NetIncomeInput): NetIncomeResult {
  const { grossIncome } = input;
  const familyEmployeeSalary = input.familyEmployeeSalary ?? 0;
  const blueReturnDeduction = input.blueReturnDeduction ?? 0;
  if (!isIntegerYen(grossIncome)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      "grossIncome must be an integer yen amount",
    );
  }
  if (!isIntegerYen(familyEmployeeSalary) || familyEmployeeSalary < 0) {
    throw new DomainError(
      "INVALID_AMOUNT",
      "familyEmployeeSalary must be a non-negative integer yen amount",
    );
  }
  if (
    !isIntegerYen(blueReturnDeduction) ||
    blueReturnDeduction < 0 ||
    blueReturnDeduction > BLUE_RETURN_DEDUCTION_MAX
  ) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `blueReturnDeduction must be between 0 and ${BLUE_RETURN_DEDUCTION_MAX}`,
    );
  }

  const incomeAfterFamilySalary = grossIncome - familyEmployeeSalary;
  const deductionBase = Math.max(0, incomeAfterFamilySalary);
  const appliedDeduction = Math.min(blueReturnDeduction, deductionBase);
  return {
    incomeAfterFamilySalary,
    appliedDeduction,
    netIncome: deductionBase - appliedDeduction,
  };
}
