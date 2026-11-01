import { DomainError } from "./errors";
import { addYen, assertNonNegativeYen } from "./money";
import type { TaxCategory, TaxMode } from "./types";

export type ConsumptionTaxRate = "standard" | "reduced";

export type TaxBasis = "inclusive" | "exclusive";

export type SimplifiedBusinessClass = 1 | 2 | 3 | 4 | 5 | 6;

type Fraction = readonly [numerator: number, denominator: number];

const TAX_MODES: readonly TaxMode[] = ["exempt", "simple", "standard"];

/**
 * 税率は既約分数で保持し、浮動小数点を介さず整数演算だけで
 * 端数を切り捨てる(10%: 税抜×1/10, 税込×10/110=1/11 / 8%: 2/25, 8/108=2/27)。
 */
const TAX_FRACTIONS: Record<
  ConsumptionTaxRate,
  { exclusive: Fraction; inclusive: Fraction }
> = {
  standard: { exclusive: [1, 10], inclusive: [1, 11] },
  reduced: { exclusive: [2, 25], inclusive: [2, 27] },
};

/** 簡易課税のみなし仕入率(第1種 90% 〜 第6種 40%)。 */
const DEEMED_PURCHASE_FRACTIONS: Record<SimplifiedBusinessClass, Fraction> = {
  1: [9, 10],
  2: [8, 10],
  3: [7, 10],
  4: [6, 10],
  5: [5, 10],
  6: [4, 10],
};

function floorFraction(amountYen: number, [numerator, denominator]: Fraction): number {
  const product = amountYen * numerator;
  if (!Number.isSafeInteger(product)) {
    throw new DomainError("INVALID_AMOUNT", "yen amount overflow");
  }
  return Math.floor(product / denominator);
}

export interface TaxComputation {
  /** amount が税込(inclusive)か税抜(exclusive)か */
  basis: TaxBasis;
  /** 税率区分。standard=10%, reduced=8%(軽減税率)。省略時 standard */
  rate?: ConsumptionTaxRate;
}

/**
 * 消費税額を算出する。端数は常に切り捨て(ACCOUNTING_RULES.md)。
 */
export function computeTaxAmount(
  amountYen: number,
  { basis, rate = "standard" }: TaxComputation,
): number {
  assertNonNegativeYen(amountYen, "amount");
  if (basis !== "inclusive" && basis !== "exclusive") {
    throw new DomainError(
      "VALIDATION_FAILED",
      `basis must be one of inclusive/exclusive`,
    );
  }
  const fraction = TAX_FRACTIONS[rate]?.[basis];
  if (!fraction) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `rate must be one of standard/reduced`,
    );
  }
  return floorFraction(amountYen, fraction);
}

/** 税込金額から消費税を除いた本体価格(円・整数)。 */
export function computeNetAmount(
  amountYen: number,
  rate: ConsumptionTaxRate = "standard",
): number {
  return amountYen - computeTaxAmount(amountYen, { basis: "inclusive", rate });
}

/** 明細ごとの消費税をそれぞれ切り捨ててから合算する。 */
export function sumTaxAmounts(
  items: readonly (TaxComputation & { amount: number })[],
): number {
  let total = 0;
  for (const item of items) {
    total = addYen(total, computeTaxAmount(item.amount, item));
  }
  return total;
}

/** 課税取引(消費税を含み得る)かどうか。非課税・免税・不課税は税額0。 */
export function isTaxableCategory(category: TaxCategory): boolean {
  return category === "taxable";
}

/**
 * amount に含まれ得る(または上乗せられ得る)消費税の最大値。
 * 税込解釈(×10/110)より税抜解釈(×10%)の方が大きいため、
 * 会計方式が未特定の入力では税抜・標準税率を上限として使う。
 */
export function maxPossibleTaxAmount(amountYen: number): number {
  assertNonNegativeYen(amountYen, "amount");
  return floorFraction(amountYen, TAX_FRACTIONS.standard.exclusive);
}

/**
 * taxAmount が税区分と金額に対して整合するかを検証する。
 * 非課税・免税・不課税は税額0固定、課税は maxPossibleTaxAmount を上限とする。
 */
export function assertTaxAmountConsistent(
  taxCategory: TaxCategory,
  amountYen: number,
  taxAmountYen: number,
): void {
  assertNonNegativeYen(taxAmountYen, "taxAmount");
  if (!isTaxableCategory(taxCategory)) {
    if (taxAmountYen !== 0) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `taxAmount must be 0 for taxCategory ${taxCategory}`,
      );
    }
    return;
  }
  const max = maxPossibleTaxAmount(amountYen);
  if (taxAmountYen > max) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `taxAmount exceeds the maximum possible tax ${max} for amount ${amountYen}`,
    );
  }
}

export interface ConsumptionTaxTotals {
  /** 課税売上に係る消費税額(円・整数) */
  outputTax: number;
  /** 課税仕入に係る消費税額(円・整数)。省略時 0 */
  inputTax?: number;
}

export interface ConsumptionTaxReport {
  mode: TaxMode;
  outputTax: number;
  /** 仕入税額控除額。簡易課税はみなし仕入れで算出した額 */
  deductibleInputTax: number;
  /** 納付税額。負数は還付相当額(本則課税のみ発生し得る) */
  taxPayable: number;
}

/**
 * 課税方式(taxMode)に応じた納付消費税額を算出する。
 * - exempt: 免税事業者。納付義務なし
 * - standard: 本則課税。outputTax - inputTax
 * - simple: 簡易課税。outputTax - floor(outputTax × みなし仕入率)
 */
export function computeConsumptionTaxPayable(
  mode: TaxMode,
  totals: ConsumptionTaxTotals,
  options: { businessClass?: SimplifiedBusinessClass } = {},
): ConsumptionTaxReport {
  if (!TAX_MODES.includes(mode)) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `mode must be one of ${TAX_MODES.join("/")}`,
    );
  }
  const outputTax = totals.outputTax;
  const inputTax = totals.inputTax ?? 0;
  assertNonNegativeYen(outputTax, "outputTax");
  assertNonNegativeYen(inputTax, "inputTax");
  const { businessClass } = options;

  if (mode === "exempt") {
    if (businessClass !== undefined) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "businessClass is only valid for simple mode",
      );
    }
    return { mode, outputTax, deductibleInputTax: 0, taxPayable: 0 };
  }

  if (mode === "simple") {
    const fraction =
      businessClass !== undefined
        ? DEEMED_PURCHASE_FRACTIONS[businessClass]
        : undefined;
    if (!fraction) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "businessClass (1-6) is required for simple mode",
      );
    }
    const deductibleInputTax = floorFraction(outputTax, fraction);
    return {
      mode,
      outputTax,
      deductibleInputTax,
      taxPayable: outputTax - deductibleInputTax,
    };
  }

  if (businessClass !== undefined) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "businessClass is only valid for simple mode",
    );
  }
  return {
    mode,
    outputTax,
    deductibleInputTax: inputTax,
    taxPayable: outputTax - inputTax,
  };
}
