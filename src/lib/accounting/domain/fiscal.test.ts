import { describe, expect, it } from "vitest";
import {
  findClosedPeriod,
  fiscalPeriodForDate,
  fiscalPeriodRange,
  fiscalYearOf,
} from "./fiscal";
import type { FiscalPeriodEntity } from "./types";

describe("fiscalYearOf", () => {
  it("1月始まり(暦年)は年と一致する", () => {
    expect(fiscalYearOf("2026-01-01", 1)).toBe(2026);
    expect(fiscalYearOf("2026-12-31", 1)).toBe(2026);
  });

  it("4月始まりは年度境界をまたぐ", () => {
    expect(fiscalYearOf("2026-03-31", 4)).toBe(2025);
    expect(fiscalYearOf("2026-04-01", 4)).toBe(2026);
    expect(fiscalYearOf("2026-12-31", 4)).toBe(2026);
    expect(fiscalYearOf("2027-01-15", 4)).toBe(2026);
    expect(fiscalYearOf("2027-03-31", 4)).toBe(2026);
  });

  it("12月始まりは11月まで前年度になる", () => {
    expect(fiscalYearOf("2026-11-30", 12)).toBe(2025);
    expect(fiscalYearOf("2026-12-01", 12)).toBe(2026);
  });
});

describe("fiscalPeriodRange", () => {
  it("1月始まりは暦年と一致する", () => {
    expect(fiscalPeriodRange(2026, 1)).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
  });

  it("4月始まりは翌年3月末で終わる", () => {
    expect(fiscalPeriodRange(2025, 4)).toEqual({
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    });
  });

  it("うるう年をまたぐ2月末を正しく扱う", () => {
    expect(fiscalPeriodRange(2027, 3)).toEqual({
      startDate: "2027-03-01",
      endDate: "2028-02-29",
    });
    expect(fiscalPeriodRange(2025, 3)).toEqual({
      startDate: "2025-03-01",
      endDate: "2026-02-28",
    });
  });
});

describe("fiscalPeriodForDate", () => {
  it("日付が属する期間を返す", () => {
    expect(fiscalPeriodForDate("2026-10-31", 4)).toEqual({
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    });
  });
});

describe("findClosedPeriod", () => {
  const period = (
    id: string,
    status: "open" | "closed",
    startDate: string,
    endDate: string,
  ) => ({ id, status, startDate, endDate }) as FiscalPeriodEntity;

  it("締め済み期間内の日付はその期間を返す", () => {
    const periods = [period("p1", "closed", "2026-01-01", "2026-12-31")];
    expect(findClosedPeriod(periods, "2026-06-15")?.id).toBe("p1");
  });

  it("期間の境界日も締め済み扱いになる", () => {
    const periods = [period("p1", "closed", "2026-01-01", "2026-12-31")];
    expect(findClosedPeriod(periods, "2026-01-01")?.id).toBe("p1");
    expect(findClosedPeriod(periods, "2026-12-31")?.id).toBe("p1");
  });

  it("open期間や範囲外はnullを返す", () => {
    const periods = [
      period("p1", "open", "2026-01-01", "2026-12-31"),
      period("p2", "closed", "2025-01-01", "2025-12-31"),
    ];
    expect(findClosedPeriod(periods, "2026-06-15")).toBeNull();
    expect(findClosedPeriod(periods, "2027-01-01")).toBeNull();
  });
});
