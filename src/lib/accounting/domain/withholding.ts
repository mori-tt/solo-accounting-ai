import { DomainError } from "./errors";
import type { DateRange } from "./fiscal";
import { addYen, assertNonNegativeYen, assertPositiveYen } from "./money";
import type { ISODate } from "./dates";
import type {
  TransactionStatus,
  TransactionType,
  WithholdingCategory,
} from "../types";

/**
 * 源泉徴収ドメイン。
 * - 報酬・料金等の源泉徴収税額計算(所得税法+復興特別所得税 10.21%/20.42%)
 * - 支払調書用の暦年・支払先別集計
 * - 専従者給与の源泉徴収票用集計(給与所得控除の算出を含む)
 *
 * 支払調書・源泉徴収票は暦年(1/1〜12/31)単位で作るため、
 * 会計年度(fiscalYear)ではなく calendarYear を受け取る。
 * 集計対象は確定済み(confirmed/locked)の支出取引のみ。
 */

/** 標準科目コード: 専従者給与(src/lib/accounts.ts の科目マスタと一致させる) */
export const FAMILY_SALARY_ACCOUNT = "family_salary";

/** 源泉徴収の支払区分の表示名 */
export const WITHHOLDING_CATEGORY_LABELS: Record<
  WithholdingCategory,
  string
> = {
  service_fee: "報酬・料金等",
  salary: "給与",
};

const WITHHOLDING_CATEGORIES: readonly WithholdingCategory[] = [
  "service_fee",
  "salary",
];

export function isWithholdingCategory(
  value: unknown,
): value is WithholdingCategory {
  return (
    typeof value === "string" &&
    WITHHOLDING_CATEGORIES.includes(value as WithholdingCategory)
  );
}

/** 報酬・料金の源泉徴収: 100万円以下は10.21%、超過分は20.42%(+102,100円) */
const FEE_THRESHOLD_YEN = 1_000_000;
const FEE_BASE_TAX_YEN = 102_100;

/**
 * 報酬・料金等の源泉徴収税額を算出する(1円未満切り捨て)。
 * - paymentAmount ≤ 1,000,000: paymentAmount × 10.21%
 * - paymentAmount > 1,000,000: 102,100 + (paymentAmount-1,000,000) × 20.42%
 * 給与(salary)は源泉徴収税額表(扶養人数等依存)のため自動計算しない。
 */
export function computeWithholdingTax(
  paymentAmountYen: number,
  category: WithholdingCategory,
): number {
  assertPositiveYen(paymentAmountYen, "paymentAmount");
  if (category === "salary") {
    throw new DomainError(
      "INVALID_INPUT",
      "salary withholding tax cannot be computed automatically",
    );
  }
  if (category !== "service_fee") {
    throw new DomainError(
      "INVALID_INPUT",
      `invalid withholding category: ${String(category)}`,
    );
  }
  if (paymentAmountYen <= FEE_THRESHOLD_YEN) {
    return Math.floor((paymentAmountYen * 1021) / 10000);
  }
  return (
    FEE_BASE_TAX_YEN +
    Math.floor(((paymentAmountYen - FEE_THRESHOLD_YEN) * 2042) / 10000)
  );
}

/** 暦年(1/1〜12/31)の日付範囲 */
export function calendarYearRange(calendarYear: number): DateRange {
  if (!Number.isInteger(calendarYear)) {
    throw new DomainError("VALIDATION_FAILED", "calendarYear must be an integer");
  }
  return {
    startDate: `${calendarYear}-01-01` as ISODate,
    endDate: `${calendarYear}-12-31` as ISODate,
  };
}

function confirmedOrLocked(status: TransactionStatus): boolean {
  return status === "confirmed" || status === "locked";
}

/** 集計に必要な取引の最小形 */
export interface WithholdingTxLike {
  id: string;
  type: TransactionType;
  date: string;
  amount: number;
  account: string;
  counterparty: string;
  status: TransactionStatus;
}

/** 集計に必要なレコードの最小形 */
export interface WithholdingRecordLike {
  transactionId: string;
  category: WithholdingCategory;
  paymentAmount: number;
  taxAmount: number;
  note?: string;
}

/** 取引先未設定の支払先名の代替表示 */
export const UNNAMED_PAYEE = "(取引先未設定)";

/* ------------------------------------------------------------------ */
/* 支払調書(報酬・料金等)の暦年集計                                       */
/* ------------------------------------------------------------------ */

/** 支払調書の内訳行(取引単位) */
export interface PaymentRecordRow {
  transactionId: string;
  date: string;
  /** 支払額(対象支払額。取引額ではなくレコード側の値) */
  paymentAmount: number;
  /** 源泉徴収税額 */
  taxAmount: number;
  /** 細目(note) */
  note?: string;
}

/** 支払先別の集計行 */
export interface PaymentRecordPayee {
  payee: string;
  paymentTotal: number;
  taxTotal: number;
  /** 対象取引件数 */
  count: number;
  /** 明細(日付昇順) */
  rows: PaymentRecordRow[];
}

export interface PaymentRecordReport {
  calendarYear: number;
  range: DateRange;
  /** 支払先名の昇順 */
  payees: PaymentRecordPayee[];
  totalPayment: number;
  totalTax: number;
  /**
   * 集計対象外となったレコード件数。
   * 下書き取引・対象期間外・salary区分・リンク先取引なしの合計。
   */
  excludedCount: number;
}

/**
 * 報酬・料金等(service_fee)のレコードを、暦年・支払先別に集計する。
 * 支払先は取引の counterparty を使う(未設定は UNNAMED_PAYEE にまとめる)。
 */
export function buildPaymentRecordReport(
  transactions: readonly WithholdingTxLike[],
  records: readonly WithholdingRecordLike[],
  calendarYear: number,
): PaymentRecordReport {
  const range = calendarYearRange(calendarYear);
  const txById = new Map(transactions.map((t) => [t.id, t]));

  const byPayee = new Map<string, PaymentRecordPayee>();
  let excludedCount = 0;
  for (const record of records) {
    if (record.category !== "service_fee") continue;
    const tx = txById.get(record.transactionId);
    if (
      tx === undefined ||
      !confirmedOrLocked(tx.status) ||
      tx.date < range.startDate ||
      tx.date > range.endDate
    ) {
      excludedCount += 1;
      continue;
    }
    const payee = tx.counterparty || UNNAMED_PAYEE;
    let row = byPayee.get(payee);
    if (row === undefined) {
      row = { payee, paymentTotal: 0, taxTotal: 0, count: 0, rows: [] };
      byPayee.set(payee, row);
    }
    row.count += 1;
    row.paymentTotal = addYen(row.paymentTotal, record.paymentAmount);
    row.taxTotal = addYen(row.taxTotal, record.taxAmount);
    row.rows.push({
      transactionId: tx.id,
      date: tx.date,
      paymentAmount: record.paymentAmount,
      taxAmount: record.taxAmount,
      ...(record.note !== undefined ? { note: record.note } : {}),
    });
  }

  const payees = [...byPayee.values()].sort((a, b) =>
    a.payee.localeCompare(b.payee, "ja"),
  );
  for (const p of payees) {
    p.rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    calendarYear,
    range,
    payees,
    totalPayment: payees.reduce((s, p) => addYen(s, p.paymentTotal), 0),
    totalTax: payees.reduce((s, p) => addYen(s, p.taxTotal), 0),
    excludedCount,
  };
}

/* ------------------------------------------------------------------ */
/* 給与所得控除・専従者源泉徴収票                                         */
/* ------------------------------------------------------------------ */

/**
 * 給与所得控除額(令和2年分以降の控除表・1円精度)。
 * 支払金額(年間給与総給与総額・円)から算出する。
 */
export function computeSalaryIncomeDeduction(grossYen: number): number {
  assertNonNegativeYen(grossYen, "grossAmount");
  if (grossYen <= 1_625_000) return 550_000;
  if (grossYen <= 1_800_000) {
    return Math.floor((grossYen * 4) / 10) - 100_000;
  }
  if (grossYen <= 3_600_000) {
    return Math.floor((grossYen * 3) / 10) + 80_000;
  }
  if (grossYen <= 6_600_000) {
    return Math.floor((grossYen * 2) / 10) + 440_000;
  }
  if (grossYen <= 8_500_000) {
    return Math.floor(grossYen / 10) + 1_100_000;
  }
  return 1_950_000;
}

/** 源泉徴収票の内訳行(取引単位) */
export interface SalarySlipRow {
  transactionId: string;
  date: string;
  /** 支払金額(取引額) */
  amount: number;
  /** この支払いで源泉徴収した税額(レコード無しは0) */
  taxAmount: number;
}

/** 専従者1人分の源泉徴収票データ */
export interface FamilySalarySlip {
  /** 支払を受ける者(取引先名) */
  payee: string;
  /** 支払金額(年間給与総額・円) */
  grossAmount: number;
  /** 給与所得控除額 */
  deductionAmount: number;
  /** 給与所得控除後の金額 */
  netAmount: number;
  /** 源泉徴収税額(紐付く給与レコードの合計) */
  taxAmount: number;
  /** 明細(日付昇順) */
  rows: SalarySlipRow[];
}

export interface FamilySalarySlipReport {
  calendarYear: number;
  range: DateRange;
  /** 支払を受ける者の昇順 */
  slips: FamilySalarySlip[];
}

/**
 * 専従者給与の源泉徴収票を暦年で組み立てる。
 * 給与の支払いは次の和集合を対象とする:
 * - account が専従者給与(FAMILY_SALARY_ACCOUNT)の確定済み支出取引
 * - salary区分の源泉徴収レコードが紐付く確定済み支出取引
 *   (カスタム科目で給与を記録している場合の捕捉用)
 * 支払を受ける者は取引の counterparty(未設定は UNNAMED_PAYEE)。
 */
export function buildFamilySalarySlips(
  transactions: readonly WithholdingTxLike[],
  records: readonly WithholdingRecordLike[],
  calendarYear: number,
): FamilySalarySlipReport {
  const range = calendarYearRange(calendarYear);
  const salaryRecordTax = new Map<string, number>();
  const salaryTxIds = new Set<string>();
  for (const record of records) {
    if (record.category !== "salary") continue;
    salaryTxIds.add(record.transactionId);
    salaryRecordTax.set(
      record.transactionId,
      addYen(salaryRecordTax.get(record.transactionId) ?? 0, record.taxAmount),
    );
  }

  const byPayee = new Map<string, FamilySalarySlip>();
  for (const tx of transactions) {
    if (tx.type !== "expense" || !confirmedOrLocked(tx.status)) continue;
    if (tx.date < range.startDate || tx.date > range.endDate) continue;
    const isSalary =
      tx.account === FAMILY_SALARY_ACCOUNT || salaryTxIds.has(tx.id);
    if (!isSalary) continue;

    const payee = tx.counterparty || UNNAMED_PAYEE;
    let slip = byPayee.get(payee);
    if (slip === undefined) {
      slip = {
        payee,
        grossAmount: 0,
        deductionAmount: 0,
        netAmount: 0,
        taxAmount: 0,
        rows: [],
      };
      byPayee.set(payee, slip);
    }
    const taxAmount = salaryRecordTax.get(tx.id) ?? 0;
    slip.grossAmount = addYen(slip.grossAmount, tx.amount);
    slip.taxAmount = addYen(slip.taxAmount, taxAmount);
    slip.rows.push({
      transactionId: tx.id,
      date: tx.date,
      amount: tx.amount,
      taxAmount,
    });
  }

  const slips = [...byPayee.values()].sort((a, b) =>
    a.payee.localeCompare(b.payee, "ja"),
  );
  for (const slip of slips) {
    slip.rows.sort((a, b) => a.date.localeCompare(b.date));
    slip.deductionAmount = computeSalaryIncomeDeduction(slip.grossAmount);
    slip.netAmount = Math.max(0, slip.grossAmount - slip.deductionAmount);
  }
  return { calendarYear, range, slips };
}
