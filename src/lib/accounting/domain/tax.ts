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

/* ------------------------------------------------------------------ */
/* 確定申告レベルの計算(付表1-3/第二表の手順に対応)                       */
/* ------------------------------------------------------------------ */

/** 課税標準額の算出割合: 税込対価合計 × 100/110(軽減税率は ×100/108)。 */
const TAXABLE_BASE_FRACTIONS: Record<ConsumptionTaxRate, Fraction> = {
  standard: [10, 11],
  reduced: [25, 27],
};

/** 課税標準額に対する消費税(国税)率: 標準 7.8%、軽減 6.24%。 */
const NATIONAL_TAX_FRACTIONS: Record<ConsumptionTaxRate, Fraction> = {
  standard: [39, 500],
  reduced: [39, 625],
};

/** 課税仕入れに係る消費税額: 税込支払対価合計 × 7.8/110(軽減は 6.24/108)。 */
const INPUT_TAX_FRACTIONS: Record<ConsumptionTaxRate, Fraction> = {
  standard: [39, 550],
  reduced: [13, 225],
};

/** 地方消費税 = 消費税額 × 22/78(標準 2.2%、軽減 1.76% に相当)。 */
const LOCAL_TAX_FRACTION: Fraction = [11, 39];

const TAXABLE_BASE_UNIT = 1_000;
const PAYABLE_UNIT = 100;
const FILING_RATES: readonly ConsumptionTaxRate[] = ["standard", "reduced"];

function floorToUnit(amountYen: number, unit: number): number {
  return Math.floor(amountYen / unit) * unit;
}

/**
 * 課税資産の譲渡等の対価の額(税込合計)から課税標準額を算出する。
 * 申告書の手順どおり税込合計に 100/110(軽減は 100/108)を掛けて税抜対価を
 * 求めてから千円未満を切り捨てる。税率区分ごとに別々に算出する。
 */
export function computeTaxableBase(
  amountInclusiveYen: number,
  rate: ConsumptionTaxRate = "standard",
): number {
  assertNonNegativeYen(amountInclusiveYen, "amountInclusive");
  const fraction = TAXABLE_BASE_FRACTIONS[rate];
  if (!fraction) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `rate must be one of standard/reduced`,
    );
  }
  return floorToUnit(
    floorFraction(amountInclusiveYen, fraction),
    TAXABLE_BASE_UNIT,
  );
}

export interface FilingTaxableAmounts {
  /** 税率区分。同一 rate の項目は合算してから課税標準額を算出する */
  rate: ConsumptionTaxRate;
  /** 課税資産の譲渡等の対価の額(税込・円) */
  salesYen: number;
  /** 課税仕入れに係る支払対価の額(税込・円)。本則課税の仕入税額に使用。省略時 0 */
  purchasesYen?: number;
}

export interface FilingRateBreakdown {
  rate: ConsumptionTaxRate;
  /** 課税標準額(千円未満切捨て後) */
  taxableBase: number;
  /** 課税標準額に対する消費税額(国税分。標準 7.8%・軽減 6.24%) */
  nationalTax: number;
  /**
   * 控除対象仕入税額(本則課税のみ算出、支払対価 × 7.8/110 or 6.24/108)。
   * 簡易課税はみなし仕入れが消費税額合計への適用のため税率別按分せず 0。
   */
  deductibleInputTax: number;
}

export interface ConsumptionTaxFiling {
  mode: TaxMode;
  /** 税率別内訳(入力に存在した税率のみ。standard→reduced 順) */
  breakdown: FilingRateBreakdown[];
  /** 課税標準額の合計 */
  totalTaxableBase: number;
  /** 課税標準額に対する消費税額(国税)の合計 */
  nationalTax: number;
  /** 控除対象仕入税額の合計。簡易課税はみなし仕入れ算出額 */
  deductibleInputTax: number;
  /**
   * 差引税額(国税・百円未満切捨て前)。地方消費税の課税標準となる
   * 消費税額でもある(第二表⑳)。負数は還付相当額
   */
  balance: number;
  /** 納付消費税額(百円未満切捨て)。還付時は 0 */
  nationalTaxPayable: number;
  /** 地方消費税の納付額(balance × 22/78 の百円未満切捨て)。還付時は 0 */
  localTaxPayable: number;
  /** 国税・地方消費税の納付合計 */
  totalPayable: number;
  /** 還付税額(国税・1円精度、百円切捨ては行わない)。納付時は 0 */
  nationalTaxRefundable: number;
  /** 譲渡割額(地方消費税の還付分・1円精度)。納付時は 0 */
  localTaxRefundable: number;
}

/**
 * 確定申告レベルの消費税・地方消費税を算出する。
 * computeConsumptionTaxPayable が集計済み税額を受け取るのに対し、こちらは
 * 税込対価の税率別合計から課税標準額(千円未満切捨て)を起点に計算する
 * 割戻し方式(付表1-3/第二表の手順に対応)。
 * - exempt: 納付義務なし。全額0、breakdown空
 * - standard: 本則課税。税率別に仕入税額を控除、残が負なら還付
 * - simple: 簡易課税。控除額 = 消費税額合計 × みなし仕入率(businessClass 必須)
 * 納付額は国税・地方税とも百円未満切捨て、還付額は1円精度。
 */
export function computeConsumptionTaxFiling(
  mode: TaxMode,
  amounts: readonly FilingTaxableAmounts[],
  options: { businessClass?: SimplifiedBusinessClass } = {},
): ConsumptionTaxFiling {
  if (!TAX_MODES.includes(mode)) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `mode must be one of ${TAX_MODES.join("/")}`,
    );
  }
  const { businessClass } = options;
  if (mode !== "simple" && businessClass !== undefined) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "businessClass is only valid for simple mode",
    );
  }

  const totals = new Map<
    ConsumptionTaxRate,
    { sales: number; purchases: number }
  >();
  for (const entry of amounts) {
    if (!FILING_RATES.includes(entry.rate)) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `rate must be one of standard/reduced`,
      );
    }
    assertNonNegativeYen(entry.salesYen, "sales");
    assertNonNegativeYen(entry.purchasesYen ?? 0, "purchases");
    const acc = totals.get(entry.rate) ?? { sales: 0, purchases: 0 };
    acc.sales = addYen(acc.sales, entry.salesYen);
    acc.purchases = addYen(acc.purchases, entry.purchasesYen ?? 0);
    totals.set(entry.rate, acc);
  }

  const filing: ConsumptionTaxFiling = {
    mode,
    breakdown: [],
    totalTaxableBase: 0,
    nationalTax: 0,
    deductibleInputTax: 0,
    balance: 0,
    nationalTaxPayable: 0,
    localTaxPayable: 0,
    totalPayable: 0,
    nationalTaxRefundable: 0,
    localTaxRefundable: 0,
  };
  if (mode === "exempt") {
    return filing;
  }

  for (const rate of FILING_RATES) {
    const acc = totals.get(rate);
    if (!acc) {
      continue;
    }
    const taxableBase = computeTaxableBase(acc.sales, rate);
    const nationalTax = floorFraction(
      taxableBase,
      NATIONAL_TAX_FRACTIONS[rate],
    );
    const deductibleInputTax =
      mode === "standard"
        ? floorFraction(acc.purchases, INPUT_TAX_FRACTIONS[rate])
        : 0;
    filing.breakdown.push({
      rate,
      taxableBase,
      nationalTax,
      deductibleInputTax,
    });
    filing.totalTaxableBase = addYen(filing.totalTaxableBase, taxableBase);
    filing.nationalTax = addYen(filing.nationalTax, nationalTax);
    filing.deductibleInputTax = addYen(
      filing.deductibleInputTax,
      deductibleInputTax,
    );
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
    filing.deductibleInputTax = floorFraction(filing.nationalTax, fraction);
  }

  const balance = filing.nationalTax - filing.deductibleInputTax;
  filing.balance = balance;
  if (balance > 0) {
    filing.nationalTaxPayable = floorToUnit(balance, PAYABLE_UNIT);
    filing.localTaxPayable = floorToUnit(
      floorFraction(balance, LOCAL_TAX_FRACTION),
      PAYABLE_UNIT,
    );
    filing.totalPayable = addYen(
      filing.nationalTaxPayable,
      filing.localTaxPayable,
    );
  } else if (balance < 0) {
    filing.nationalTaxRefundable = -balance;
    filing.localTaxRefundable = floorFraction(-balance, LOCAL_TAX_FRACTION);
  }
  return filing;
}
