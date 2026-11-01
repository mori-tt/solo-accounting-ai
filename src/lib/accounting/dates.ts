import { DomainError } from "./errors";

/**
 * 日付はタイムゾーンに依存しない `YYYY-MM-DD` 文字列で扱う。
 * 文字列比較が日付順と一致するため、範囲判定はそのまま比較演算で行う。
 */
export type DateString = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function lastDayOfMonth(year: number, month: number): number {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12) {
    throw new DomainError("INVALID_DATE", `invalid month: ${month}`);
  }
  return month === 2 && isLeapYear(year) ? 29 : days[month - 1];
}

export function parseDate(value: unknown, field = "date"): DateParts {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_DATE", `${field} must be YYYY-MM-DD`, {
      field,
      value,
    });
  }
  const m = DATE_RE.exec(value);
  if (!m) {
    throw new DomainError("INVALID_DATE", `${field} must be YYYY-MM-DD`, {
      field,
      value,
    });
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(year, month)) {
    throw new DomainError("INVALID_DATE", `${field} is not a real date`, {
      field,
      value,
    });
  }
  return { year, month, day };
}

export function assertDateString(value: unknown, field = "date"): DateString {
  parseDate(value, field);
  return value as DateString;
}

export function formatDate({ year, month, day }: DateParts): DateString {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** 月次サマリのドキュメントIDとして使う `yyyyMM` キー。 */
export function monthKeyOf(date: DateString): string {
  const { year, month } = parseDate(date);
  return `${year}${String(month).padStart(2, "0")}`;
}

export function isValidMonthKey(key: string): boolean {
  if (!/^\d{6}$/.test(key)) return false;
  const month = Number(key.slice(4, 6));
  return month >= 1 && month <= 12;
}

export function monthKeyRange(monthKey: string): {
  startDate: DateString;
  endDate: DateString;
} {
  if (!isValidMonthKey(monthKey)) {
    throw new DomainError("INVALID_DATE", `invalid month key: ${monthKey}`);
  }
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(4, 6));
  return {
    startDate: formatDate({ year, month, day: 1 }),
    endDate: formatDate({ year, month, day: lastDayOfMonth(year, month) }),
  };
}

/** date が [startDate, endDate] に含まれるか(両端含む)。 */
export function isWithinPeriod(
  date: DateString,
  startDate: DateString,
  endDate: DateString,
): boolean {
  return date >= startDate && date <= endDate;
}

export function assertFiscalStartMonth(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 12
  ) {
    throw new DomainError(
      "INVALID_FISCAL_MONTH",
      "fiscalYearStartMonth must be an integer between 1 and 12",
      { value },
    );
  }
  return value;
}

export interface FiscalPeriodBounds {
  /** 会計年度の開始年(例: 4月始まりの 2025-04-01〜2026-03-31 なら 2025)。 */
  fiscalYear: number;
  startDate: DateString;
  endDate: DateString;
}

/**
 * 指定年度開始年の会計期間の範囲を返す。
 * startMonth=1 なら暦年、4 なら 4/1〜翌3/31。
 */
export function fiscalPeriodBounds(
  fiscalYear: number,
  startMonth: number,
): FiscalPeriodBounds {
  assertFiscalStartMonth(startMonth);
  const startDate = formatDate({ year: fiscalYear, month: startMonth, day: 1 });
  if (startMonth === 1) {
    return { fiscalYear, startDate, endDate: `${fiscalYear}-12-31` };
  }
  const endYear = fiscalYear + 1;
  const endMonth = startMonth - 1;
  const endDate = formatDate({
    year: endYear,
    month: endMonth,
    day: lastDayOfMonth(endYear, endMonth),
  });
  return { fiscalYear, startDate, endDate };
}

/** date を含む会計期間の範囲を返す。 */
export function fiscalPeriodOf(
  date: DateString,
  startMonth: number,
): FiscalPeriodBounds {
  const { year, month } = parseDate(date);
  const fiscalYear = startMonth === 1 || month >= startMonth ? year : year - 1;
  return fiscalPeriodBounds(fiscalYear, startMonth);
}
