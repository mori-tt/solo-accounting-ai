import type { DepreciationMethod } from "../types";
import { assertISODate, type ISODate } from "./dates";
import { DomainError } from "./errors";
import { fiscalPeriodRange, fiscalYearOf } from "./fiscal";
import { isIntegerYen } from "./money";

/**
 * 減価償却計算(個人事業・所得税ベース)。
 *
 * - 金額は円単位の整数。年間償却費は切り捨てで算出する
 * - 取得・除却は月単位で按分し、その会計年度に保有した月数(1-12)を掛ける
 * - 帳簿価額は備忘価額1円(MEMO_BOOK_VALUE)まで償却できる
 * - 定率法は200%定率法(償却率=2/耐用年数)。残存月数で割った均等額が
 *   定率額を上回る年度から均等償却へ切り替える(改定償却率・保証率の近似。
 *   国税庁の償却率表とほぼ同じ償却期間・累計額になる)
 * - 家事按分はここでは扱わず、償却費(全額)を返す。経費計上額は
 *   呼び出し側が allocatedAmount で事業割合を掛けて求める
 */

export type { DepreciationMethod };

/** 備忘価額。償却は帳簿価額が1円になるまで行う */
export const MEMO_BOOK_VALUE = 1;

export interface DepreciableAsset {
  /** 取得価額(円・整数・正数) */
  acquisitionCost: number;
  /** 耐用年数(年・整数) */
  usefulLifeYears: number;
  method: DepreciationMethod;
  /** 取得日 YYYY-MM-DD */
  acquiredDate: ISODate;
  /** 除却日 YYYY-MM-DD(任意) */
  disposedDate?: ISODate;
}

const DEPRECIATION_METHODS: readonly DepreciationMethod[] = [
  "straightLine",
  "decliningBalance",
];

export function assertDepreciableAsset(
  asset: DepreciableAsset,
): asserts asset is DepreciableAsset {
  assertISODate(asset.acquiredDate, "acquiredDate");
  if (asset.disposedDate !== undefined) {
    assertISODate(asset.disposedDate, "disposedDate");
    if (asset.disposedDate < asset.acquiredDate) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "disposedDate must not be before acquiredDate",
      );
    }
  }
  if (!isIntegerYen(asset.acquisitionCost) || asset.acquisitionCost <= 0) {
    throw new DomainError(
      "INVALID_AMOUNT",
      "acquisitionCost must be a positive integer yen amount",
    );
  }
  if (
    !Number.isInteger(asset.usefulLifeYears) ||
    asset.usefulLifeYears < 1
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "usefulLifeYears must be a positive integer",
    );
  }
  if (!DEPRECIATION_METHODS.includes(asset.method)) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `invalid depreciation method: ${String(asset.method)}`,
    );
  }
}

/** 日付を 年*12+月 の連番に変換(月差の計算用) */
function monthIndex(date: ISODate): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
}

/**
 * 会計年度内で資産を保有した月数(0-12)。
 * 取得月・除却月はそれぞれ1か月として数える(月割り償却)。
 */
export function monthsHeldInFiscalYear(
  asset: Pick<DepreciableAsset, "acquiredDate" | "disposedDate">,
  fiscalYear: number,
  fiscalYearStartMonth: number,
): number {
  const { startDate, endDate } = fiscalPeriodRange(
    fiscalYear,
    fiscalYearStartMonth,
  );
  const heldFrom = Math.max(
    monthIndex(startDate),
    monthIndex(asset.acquiredDate),
  );
  const heldUntil = Math.min(
    monthIndex(endDate),
    asset.disposedDate !== undefined
      ? monthIndex(asset.disposedDate)
      : monthIndex(endDate),
  );
  return Math.max(0, heldUntil - heldFrom + 1);
}

/** 定額法の当年償却費(円・整数)。取得価額 × 保有月数/(耐用年数×12) を切り捨て */
function straightLineCharge(
  acquisitionCost: number,
  usefulLifeYears: number,
  months: number,
): number {
  return Math.floor((acquisitionCost * months) / (usefulLifeYears * 12));
}

/** 定率法の当年償却費(円・整数)。期首帳簿価額 × 2/耐用年数 × 月数/12 を切り捨て */
function decliningBalanceCharge(
  bookValueAtStart: number,
  usefulLifeYears: number,
  months: number,
): number {
  return Math.floor(
    (bookValueAtStart * 2 * months) / (usefulLifeYears * 12),
  );
}

export interface FiscalYearDepreciation {
  /** 対象の会計年度(開始年) */
  fiscalYear: number;
  /** その年度に保有した月数(0-12) */
  months: number;
  /** その年度の償却費(円・整数・按分前) */
  expense: number;
  /** 年度末時点の償却累計(円・整数) */
  accumulated: number;
  /** 年度末時点の帳簿価額(円・整数) */
  bookValue: number;
}

/**
 * 指定会計年度末時点の償却状態を返す。
 * 取得から対象年度まで各年の償却費を順に計算して累計・帳簿価額を求める。
 * 対象年度に保有月が無い/償却済みの場合は expense=0 で累計のみ返る。
 * 取得前の年度を指定した場合は expense=0, accumulated=0, bookValue=取得価額。
 */
export function fiscalYearEndDepreciation(
  asset: DepreciableAsset,
  fiscalYearStartMonth: number,
  fiscalYear: number,
): FiscalYearDepreciation {
  assertDepreciableAsset(asset);
  const acquisitionYear = fiscalYearOf(
    asset.acquiredDate,
    fiscalYearStartMonth,
  );
  const totalMonths = asset.usefulLifeYears * 12;

  let accumulated = 0;
  let elapsedMonths = 0;
  let months = 0;
  let expense = 0;

  for (let fy = acquisitionYear; fy <= fiscalYear; fy++) {
    const held = monthsHeldInFiscalYear(asset, fy, fiscalYearStartMonth);
    const bookValueAtStart = asset.acquisitionCost - accumulated;
    if (held === 0 || bookValueAtStart <= MEMO_BOOK_VALUE) {
      months = 0;
      expense = 0;
      break;
    }

    let charge: number;
    if (asset.method === "straightLine") {
      charge = straightLineCharge(
        asset.acquisitionCost,
        asset.usefulLifeYears,
        held,
      );
    } else {
      const remainingMonths = totalMonths - elapsedMonths;
      const declining = decliningBalanceCharge(
        bookValueAtStart,
        asset.usefulLifeYears,
        held,
      );
      // 残存耐用月数に帳簿価額(−1円)を均等に割った額と大きい方を採用し、
      // 耐用年数内に償却が終わるよう定率→定額の切り替えを近似する
      const level =
        remainingMonths > 0
          ? Math.floor(
              ((bookValueAtStart - MEMO_BOOK_VALUE) * held) / remainingMonths,
            )
          : bookValueAtStart - MEMO_BOOK_VALUE;
      charge = Math.max(declining, level);
    }

    // 償却限度額: 帳簿価額が備忘価額1円を下回らない
    charge = Math.min(charge, bookValueAtStart - MEMO_BOOK_VALUE);
    accumulated += charge;
    months = held;
    expense = charge;
    elapsedMonths += held;
  }

  return {
    fiscalYear,
    months,
    expense,
    accumulated,
    bookValue: asset.acquisitionCost - accumulated,
  };
}

/**
 * 指定会計年度に償却費の計上対象になるか。
 * 保有月があり償却残がある場合のみ true。
 */
export function isDepreciableForFiscalYear(
  asset: DepreciableAsset,
  fiscalYearStartMonth: number,
  fiscalYear: number,
): boolean {
  const state = fiscalYearEndDepreciation(
    asset,
    fiscalYearStartMonth,
    fiscalYear,
  );
  return state.months > 0 && state.expense > 0;
}
