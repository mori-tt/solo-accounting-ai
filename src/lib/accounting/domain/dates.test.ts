import { describe, expect, it } from "vitest";
import {
  compareISODate,
  daysBetween,
  isISODateString,
  isYearMonth,
  lastDayOfMonth,
  todayISO,
  yearMonthOf,
} from "./dates";

describe("isISODateString", () => {
  it("正常な日付を受け入れる", () => {
    expect(isISODateString("2026-01-01")).toBe(true);
    expect(isISODateString("2026-12-31")).toBe(true);
  });

  it("うるう年の2月29日を受け入れる", () => {
    expect(isISODateString("2024-02-29")).toBe(true);
    expect(isISODateString("2028-02-29")).toBe(true);
  });

  it("平年の2月29日を拒否する", () => {
    expect(isISODateString("2026-02-29")).toBe(false);
    expect(isISODateString("2100-02-29")).toBe(false);
  });

  it("存在しない日付を拒否する", () => {
    expect(isISODateString("2026-02-30")).toBe(false);
    expect(isISODateString("2026-04-31")).toBe(false);
    expect(isISODateString("2026-00-10")).toBe(false);
    expect(isISODateString("2026-13-01")).toBe(false);
    expect(isISODateString("2026-01-00")).toBe(false);
    expect(isISODateString("2026-01-32")).toBe(false);
  });

  it("形式が不正な文字列を拒否する", () => {
    expect(isISODateString("2026-1-1")).toBe(false);
    expect(isISODateString("2026/01/01")).toBe(false);
    expect(isISODateString("")).toBe(false);
    expect(isISODateString("2026-01-01T00:00:00Z")).toBe(false);
    expect(isISODateString(20260101)).toBe(false);
  });
});

describe("yearMonthOf", () => {
  it("月末日の取引はその月に属する", () => {
    expect(yearMonthOf("2026-01-31")).toBe("2026-01");
    expect(yearMonthOf("2026-03-31")).toBe("2026-03");
  });

  it("月初日は新しい月に属する", () => {
    expect(yearMonthOf("2026-02-01")).toBe("2026-02");
    expect(yearMonthOf("2026-04-01")).toBe("2026-04");
  });
});

describe("isYearMonth", () => {
  it("YYYY-MM形式を受け入れる", () => {
    expect(isYearMonth("2026-01")).toBe(true);
    expect(isYearMonth("2026-12")).toBe(true);
  });

  it("不正な月を拒否する", () => {
    expect(isYearMonth("2026-00")).toBe(false);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth("2026-1")).toBe(false);
    expect(isYearMonth("2026-01-01")).toBe(false);
  });
});

describe("lastDayOfMonth", () => {
  it("各月の末日を返す", () => {
    expect(lastDayOfMonth(2026, 1)).toBe(31);
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });

  it("うるう年の2月を正しく扱う", () => {
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 2)).toBe(28);
  });
});

describe("daysBetween", () => {
  it("日数差を返す", () => {
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-10-31", "2026-10-31")).toBe(0);
  });
});

describe("compareISODate", () => {
  it("日付順に比較する", () => {
    expect(compareISODate("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compareISODate("2026-01-02", "2026-01-01")).toBe(1);
    expect(compareISODate("2026-01-01", "2026-01-01")).toBe(0);
  });
});

describe("todayISO", () => {
  it("UTC基準でYYYY-MM-DDを返す", () => {
    expect(todayISO(new Date("2026-10-31T15:00:00.000Z"))).toBe("2026-10-31");
  });
});
