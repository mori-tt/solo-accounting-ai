import { describe, expect, it } from "vitest";
import { buildYearComparison, yoyRate } from "./compare";
import { buildYearlyReport, type YearlyTransaction } from "./yearly";

function tx(
  id: string,
  overrides: Partial<YearlyTransaction> = {},
): YearlyTransaction {
  return {
    id,
    type: "income",
    date: "2026-05-10",
    amount: 1000,
    account: "sales",
    status: "confirmed",
    ...overrides,
  };
}

describe("yoyRate", () => {
  it("増加は正の%、減少は負の%を返す", () => {
    expect(yoyRate(1200, 1000)).toBeCloseTo(20);
    expect(yoyRate(750, 1000)).toBeCloseTo(-25);
  });

  it("前年が0以下のときは null(率を定義できない)", () => {
    expect(yoyRate(1000, 0)).toBeNull();
    expect(yoyRate(1000, -500)).toBeNull();
  });

  it("前年正・当年0は -100%", () => {
    expect(yoyRate(0, 1000)).toBe(-100);
  });
});

describe("buildYearComparison", () => {
  it("年度を古い順に並べ、年間合計の対前年率を付ける", () => {
    // 入力順が新しい順でもソートされる
    const comparison = buildYearComparison([
      buildYearlyReport([tx("t3", { amount: 1500 })], 2026, 1),
      buildYearlyReport(
        [tx("t1", { date: "2024-06-01", amount: 1000 })],
        2024,
        1,
      ),
      buildYearlyReport(
        [tx("t2", { date: "2025-06-01", amount: 1200 })],
        2025,
        1,
      ),
    ]);

    expect(comparison.fiscalYears).toEqual([2024, 2025, 2026]);
    expect(comparison.annual.income.amounts).toEqual([1000, 1200, 1500]);
    expect(comparison.annual.income.yoyRates[0]).toBeNull();
    expect(comparison.annual.income.yoyRates[1]).toBeCloseTo(20);
    expect(comparison.annual.income.yoyRates[2]).toBeCloseTo(25);
  });

  it("利益は収入-支出で算出し、経費にも対前年率を付ける", () => {
    const comparison = buildYearComparison([
      buildYearlyReport(
        [
          tx("i1", { date: "2025-03-01", amount: 1000 }),
          tx("e1", {
            date: "2025-03-02",
            type: "expense",
            account: "supplies",
            amount: 400,
          }),
        ],
        2025,
        1,
      ),
      buildYearlyReport(
        [
          tx("i2", { date: "2026-03-01", amount: 2000 }),
          tx("e2", {
            date: "2026-03-02",
            type: "expense",
            account: "supplies",
            amount: 300,
          }),
        ],
        2026,
        1,
      ),
    ]);

    expect(comparison.annual.expense.amounts).toEqual([400, 300]);
    expect(comparison.annual.expense.yoyRates[1]).toBeCloseTo(-25);
    expect(comparison.annual.profit.amounts).toEqual([600, 1700]);
    expect(comparison.annual.profit.yoyRates[1]).toBeCloseTo(
      (1100 / 600) * 100,
    );
  });

  it("月別行は最新年の会計年度順で12行、同じ暦月を年またぎで比較する", () => {
    const comparison = buildYearComparison([
      // FY2025(4月始まり): 2025-04 売上1000
      buildYearlyReport([tx("a", { date: "2025-04-10", amount: 1000 })], 2025, 4),
      // FY2026(4月始まり): 2026-04 売上1500 + 2026-05 支出200
      buildYearlyReport(
        [
          tx("b", { date: "2026-04-10", amount: 1500 }),
          tx("c", {
            date: "2026-05-10",
            type: "expense",
            account: "supplies",
            amount: 200,
          }),
        ],
        2026,
        4,
      ),
    ]);

    expect(comparison.monthly).toHaveLength(12);
    // 4月始まりなので先頭行は4月
    expect(comparison.monthly[0].month).toBe(4);
    expect(comparison.monthly[11].month).toBe(3);
    // 4月行: FY2025=1000 → FY2026=1500 で +50%
    expect(comparison.monthly[0].income.amounts).toEqual([1000, 1500]);
    expect(comparison.monthly[0].income.yoyRates[1]).toBeCloseTo(50);
    // 5月行: FY2025=0 → FY2026=0。前年0なので率は null
    expect(comparison.monthly[1].income.amounts).toEqual([0, 0]);
    expect(comparison.monthly[1].income.yoyRates[1]).toBeNull();
    // 5月の利益: FY2025=0-0=0、FY2026=0-200=-200
    expect(comparison.monthly[1].profit.amounts).toEqual([0, -200]);
  });

  it("draft・transfer の取引は集計対象外", () => {
    const comparison = buildYearComparison([
      buildYearlyReport(
        [tx("d", { status: "draft", date: "2026-02-01" })],
        2026,
        1,
      ),
    ]);
    expect(comparison.annual.income.amounts).toEqual([0]);
    expect(comparison.monthly.every((m) => m.income.amounts[0] === 0)).toBe(
      true,
    );
  });
});
