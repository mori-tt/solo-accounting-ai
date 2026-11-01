import { describe, expect, it } from "vitest";
import type { FiscalPeriod } from "@/lib/accounting/types";
import { countUnclosedMonths } from "./unclosed-months";

function period(
  id: string,
  startDate: string,
  endDate: string,
  status: "open" | "closed",
): FiscalPeriod {
  return { id, fiscalYear: 2025, startDate, endDate, status };
}

describe("countUnclosedMonths", () => {
  it("期間も取引も無ければ0", () => {
    expect(countUnclosedMonths([], [], "202611")).toBe(0);
  });

  it("期間未作成でも取引がある前月以前の月を数える", () => {
    const months = ["202508", "202509", "202510"];
    expect(countUnclosedMonths([], months, "202511")).toBe(3);
  });

  it("当月の取引は対象外(前月以前のみ)", () => {
    const months = ["202510", "202511"];
    expect(countUnclosedMonths([], months, "202511")).toBe(1);
  });

  it("open期間がカバーする前月以前の月をすべて数える", () => {
    const periods = [period("fy2026", "2026-01-01", "2026-12-31", "open")];
    expect(countUnclosedMonths(periods, [], "202611")).toBe(10);
  });

  it("open期間の未来月は数えない", () => {
    const periods = [period("fy2026", "2026-01-01", "2026-12-31", "open")];
    expect(countUnclosedMonths(periods, [], "202603")).toBe(2);
  });

  it("closed期間内の月は取引があっても数えない", () => {
    const periods = [
      period("fy2025", "2025-01-01", "2025-12-31", "closed"),
      period("fy2026", "2026-01-01", "2026-12-31", "open"),
    ];
    const months = ["202506", "202602"];
    // 2025-06はclosed、open期間の2026-01〜10の10ヶ月
    expect(countUnclosedMonths(periods, months, "202611")).toBe(10);
  });

  it("open期間と期間外の取引月の和集合を数える", () => {
    const periods = [period("fy2025", "2025-04-01", "2026-03-31", "open")];
    // 期間外(2026-04)の取引 + open期間の2025-04〜2026-03(12ヶ月)
    const months = ["202604", "202507"];
    expect(countUnclosedMonths(periods, months, "202605")).toBe(13);
  });

  it("open期間の月と重複する取引月は重複して数えない", () => {
    const periods = [period("fy2026", "2026-01-01", "2026-12-31", "open")];
    const months = ["202601", "202602", "202603"];
    expect(countUnclosedMonths(periods, months, "202611")).toBe(10);
  });
});
