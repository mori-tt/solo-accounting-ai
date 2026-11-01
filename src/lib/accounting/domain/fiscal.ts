import {
  assertISODate,
  isWithinRange,
  lastDayOfMonth,
  pad2,
  type ISODate,
} from "./dates";
import { DomainError } from "./errors";
import type { FiscalPeriodEntity } from "./types";

export interface DateRange {
  startDate: ISODate;
  endDate: ISODate;
}

export function assertFiscalYearStartMonth(
  value: unknown,
): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 12) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "fiscalYearStartMonth must be an integer between 1 and 12",
    );
  }
}

export function fiscalYearOf(date: ISODate, fiscalYearStartMonth: number): number {
  assertISODate(date, "date");
  assertFiscalYearStartMonth(fiscalYearStartMonth);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= fiscalYearStartMonth ? year : year - 1;
}

export function fiscalPeriodRange(
  fiscalYear: number,
  fiscalYearStartMonth: number,
): DateRange {
  assertFiscalYearStartMonth(fiscalYearStartMonth);
  if (!Number.isInteger(fiscalYear)) {
    throw new DomainError("VALIDATION_FAILED", "fiscalYear must be an integer");
  }
  const startDate = `${fiscalYear}-${pad2(fiscalYearStartMonth)}-01`;
  const endYear = fiscalYearStartMonth === 1 ? fiscalYear : fiscalYear + 1;
  const endMonth = fiscalYearStartMonth === 1 ? 12 : fiscalYearStartMonth - 1;
  const endDate = `${endYear}-${pad2(endMonth)}-${pad2(lastDayOfMonth(endYear, endMonth))}`;
  return { startDate, endDate };
}

export function fiscalPeriodForDate(
  date: ISODate,
  fiscalYearStartMonth: number,
): DateRange {
  return fiscalPeriodRange(fiscalYearOf(date, fiscalYearStartMonth), fiscalYearStartMonth);
}

export function findClosedPeriod(
  periods: readonly Pick<FiscalPeriodEntity, "startDate" | "endDate" | "status">[],
  date: ISODate,
): FiscalPeriodEntity | null {
  assertISODate(date, "date");
  const closed = periods.find(
    (period) =>
      period.status === "closed" &&
      isWithinRange(date, period.startDate, period.endDate),
  );
  return (closed as FiscalPeriodEntity | undefined) ?? null;
}
