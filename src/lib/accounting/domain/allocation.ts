import { DomainError } from "./errors";
import { addYen, isIntegerYen } from "./money";
import type { AccountBreakdownEntry } from "./types";

/**
 * 家事按分(科目別の事業割合)。
 * Business.allocationRatios は 科目コード → 事業割合(0-100の整数%)。
 * 未設定の科目は全額を事業分とみなす(100%)。
 */

/** 科目コード → 事業割合(%)。0-100の整数。 */
export type AllocationRatios = Record<string, number>;

/** 割合未設定の科目に適用する既定値(%) */
export const DEFAULT_ALLOCATION_RATIO = 100;

export function isAllocationRatio(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

export function assertAllocationRatio(
  value: unknown,
  field: string,
): asserts value is number {
  if (!isAllocationRatio(value)) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `${field} must be an integer percent between 0 and 100`,
    );
  }
}

/**
 * 科目の事業割合(%)を返す。未設定・不正値は既定値(100%)として扱う。
 * 保存値の検証は書き込み時のスキーマが担い、表示側は壊れた値で落とさない。
 */
export function allocationRatioFor(
  ratios: AllocationRatios | undefined,
  account: string,
): number {
  const ratio = ratios?.[account];
  return isAllocationRatio(ratio) ? ratio : DEFAULT_ALLOCATION_RATIO;
}

/**
 * 按分後の事業経費額(円・整数)。
 * 端数は切り捨て(ACCOUNTING_RULES.md の初期版ルールに合わせ、
 * 経費を過大計上しない丸めとする)。
 */
export function allocatedAmount(
  amountYen: number,
  ratioPercent: number,
): number {
  if (!isIntegerYen(amountYen)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      "amountYen must be an integer yen amount",
    );
  }
  assertAllocationRatio(ratioPercent, "ratioPercent");
  const result = Math.floor((amountYen * ratioPercent) / 100);
  if (!Number.isSafeInteger(result)) {
    throw new DomainError("INVALID_AMOUNT", "yen amount overflow");
  }
  return result;
}

export interface AllocatedAccountEntry extends AccountBreakdownEntry {
  /** 適用した事業割合(%) */
  ratio: number;
  /** 按分後の経費額(円・整数)。収入には按分を適用しない */
  allocatedExpense: number;
}

/**
 * 科目別集計に按分を適用した表示用マップを返す。
 * 元データ(保存済み集計)は変更せず、表示列の追加専用。
 */
export function applyAllocation(
  breakdown: Record<string, AccountBreakdownEntry>,
  ratios: AllocationRatios | undefined,
): Record<string, AllocatedAccountEntry> {
  const out: Record<string, AllocatedAccountEntry> = {};
  for (const [account, entry] of Object.entries(breakdown)) {
    const ratio = allocationRatioFor(ratios, account);
    out[account] = {
      ...entry,
      ratio,
      allocatedExpense: allocatedAmount(entry.expense, ratio),
    };
  }
  return out;
}

/** 按分後経費の合計(円・整数) */
export function allocatedExpenseTotal(
  entries: Record<string, Pick<AllocatedAccountEntry, "allocatedExpense">>,
): number {
  let total = 0;
  for (const entry of Object.values(entries)) {
    total = addYen(total, entry.allocatedExpense);
  }
  return total;
}
