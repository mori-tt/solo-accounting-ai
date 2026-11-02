import {
  assertDateString,
  isWithinPeriod,
  lastDayOfMonth,
  parseDate,
  type DateString,
} from "../dates";
import { DomainError } from "./errors";

export type ISODate = DateString;
export type YearMonth = string;

const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function isISODateString(value: unknown): value is ISODate {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
}

export function assertISODate(
  value: unknown,
  field: string,
): asserts value is ISODate {
  assertDateString(value, field);
}

export function isYearMonth(value: unknown): value is YearMonth {
  if (typeof value !== "string") return false;
  const match = YEAR_MONTH_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function assertYearMonth(
  value: unknown,
  field: string,
): asserts value is YearMonth {
  if (!isYearMonth(value)) {
    throw new DomainError(
      "INVALID_DATE",
      `${field} must be in YYYY-MM format with month 01-12`,
    );
  }
}

export function yearMonthOf(date: ISODate): YearMonth {
  assertISODate(date, "date");
  return date.slice(0, 7);
}

export { isWithinPeriod as isWithinRange, lastDayOfMonth };

export function toUTCEpoch(date: ISODate): number {
  assertISODate(date, "date");
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function compareISODate(a: ISODate, b: ISODate): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTCEpoch(to) - toUTCEpoch(from)) / DAY_MS);
}

export function todayISO(now: Date): ISODate {
  return now.toISOString().slice(0, 10);
}
