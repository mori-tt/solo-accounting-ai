import { describe, expect, it } from "vitest";
import {
  assertDateString,
  fiscalPeriodOf,
  fiscalPeriodBounds,
  isWithinPeriod,
  lastDayOfMonth,
  monthKeyOf,
  monthKeyRange,
} from "./dates";

describe("assertDateString", () => {
  it("YYYY-MM-DD を受け入れる", () => {
    expect(assertDateString("2025-01-31")).toBe("2025-01-31");
    // うるう年
    expect(assertDateString("2024-02-29")).toBe("2024-02-29");
  });

  it("存在しない日付を拒否する", () => {
    expect(() => assertDateString("2025-02-29")).toThrowError(
      expect.objectContaining({ code: "INVALID_DATE" }),
    );
    expect(() => assertDateString("2025-02-30")).toThrowError();
    expect(() => assertDateString("2025-04-31")).toThrowError();
    expect(() => assertDateString("2025-13-01")).toThrowError();
    expect(() => assertDateString("2025-00-10")).toThrowError();
  });

  it("形式不正を拒否する", () => {
    for (const v of ["2025/01/01", "2025-1-1", "25-01-01", "abcd", "", 123]) {
      expect(() => assertDateString(v)).toThrowError(
        expect.objectContaining({ code: "INVALID_DATE" }),
      );
    }
  });
});

describe("lastDayOfMonth / monthKeyOf / monthKeyRange", () => {
  it("月末日を正しく返す(うるう年含む)", () => {
    expect(lastDayOfMonth(2025, 1)).toBe(31);
    expect(lastDayOfMonth(2025, 2)).toBe(28);
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(lastDayOfMonth(2100, 2)).toBe(28);
    expect(lastDayOfMonth(2000, 2)).toBe(29);
    expect(lastDayOfMonth(2025, 4)).toBe(30);
  });

  it("月キー yyyyMM を返す", () => {
    expect(monthKeyOf("2025-03-31")).toBe("202503");
    expect(monthKeyOf("2025-04-01")).toBe("202504");
  });

  it("月キーから範囲を復元する", () => {
    expect(monthKeyRange("202502")).toEqual({
      startDate: "2025-02-01",
      endDate: "2025-02-28",
    });
    expect(monthKeyRange("202402")).toEqual({
      startDate: "2024-02-01",
      endDate: "2024-02-29",
    });
  });
});

describe("isWithinPeriod", () => {
  it("両端を含む", () => {
    expect(isWithinPeriod("2025-01-01", "2025-01-01", "2025-12-31")).toBe(true);
    expect(isWithinPeriod("2025-12-31", "2025-01-01", "2025-12-31")).toBe(true);
    expect(isWithinPeriod("2026-01-01", "2025-01-01", "2025-12-31")).toBe(false);
  });
});

describe("fiscalPeriodBounds / fiscalPeriodOf", () => {
  it("暦年(startMonth=1)", () => {
    expect(fiscalPeriodBounds(2025, 1)).toEqual({
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
  });

  it("4月始まりは翌年3月末まで", () => {
    expect(fiscalPeriodBounds(2025, 4)).toEqual({
      fiscalYear: 2025,
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    });
  });

  it("年度境界: startMonth=4 で 3/31 と 4/1 は別年度", () => {
    expect(fiscalPeriodOf("2026-03-31", 4).fiscalYear).toBe(2025);
    expect(fiscalPeriodOf("2026-04-01", 4).fiscalYear).toBe(2026);
    expect(fiscalPeriodOf("2025-04-01", 4)).toEqual({
      fiscalYear: 2025,
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    });
  });

  it("startMonth=12 は 12/1〜翌年11/30", () => {
    expect(fiscalPeriodOf("2025-12-01", 12)).toEqual({
      fiscalYear: 2025,
      startDate: "2025-12-01",
      endDate: "2026-11-30",
    });
    expect(fiscalPeriodOf("2025-11-30", 12).fiscalYear).toBe(2024);
  });

  it("暦年の境界: 12/31 と 1/1", () => {
    expect(fiscalPeriodOf("2025-12-31", 1).fiscalYear).toBe(2025);
    expect(fiscalPeriodOf("2026-01-01", 1).fiscalYear).toBe(2026);
  });
});
