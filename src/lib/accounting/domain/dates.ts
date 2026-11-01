import { DomainError } from "./errors";

export type ISODate = string;
export type YearMonth = string;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function isISODateString(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= lastDayOfMonth(year, month);
}

export function assertISODate(
  value: unknown,
  field: string,
): asserts value is ISODate {
  if (!isISODateString(value)) {
    throw new DomainError(
      "INVALID_DATE",
      `${field} must be a real calendar date in YYYY-MM-DD format`,
    );
  }
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

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

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

export function isWithinRange(date: ISODate, start: ISODate, end: ISODate): boolean {
  return start <= date && date <= end;
}

export function todayISO(now: Date): ISODate {
  return now.toISOString().slice(0, 10);
}
