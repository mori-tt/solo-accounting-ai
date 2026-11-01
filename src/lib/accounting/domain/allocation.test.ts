import { describe, expect, it } from "vitest";
import {
  allocatedAmount,
  allocatedExpenseTotal,
  allocationRatioFor,
  applyAllocation,
} from "./allocation";
import { DomainError } from "./errors";

describe("allocatedAmount", () => {
  it("割合を掛けて円・整数で返す", () => {
    expect(allocatedAmount(100_000, 100)).toBe(100_000);
    expect(allocatedAmount(100_000, 50)).toBe(50_000);
    expect(allocatedAmount(100_000, 0)).toBe(0);
  });

  it("端数は切り捨てる", () => {
    expect(allocatedAmount(999, 50)).toBe(499);
    expect(allocatedAmount(101, 33)).toBe(33);
    expect(allocatedAmount(1, 1)).toBe(0);
  });

  it("割合が0-100の整数でなければ例外", () => {
    for (const ratio of [-1, 101, 50.5, Number.NaN]) {
      try {
        allocatedAmount(1_000, ratio);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(DomainError);
        expect((e as DomainError).code).toBe("VALIDATION_FAILED");
      }
    }
  });

  it("金額が円・整数でなければ例外", () => {
    try {
      allocatedAmount(100.5, 50);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_AMOUNT");
    }
  });
});

describe("allocationRatioFor", () => {
  it("設定済みの割合を返し、未設定科目は100%扱い", () => {
    const ratios = { rent: 50, utilities: 30 };
    expect(allocationRatioFor(ratios, "rent")).toBe(50);
    expect(allocationRatioFor(ratios, "utilities")).toBe(30);
    expect(allocationRatioFor(ratios, "supplies")).toBe(100);
    expect(allocationRatioFor(undefined, "rent")).toBe(100);
  });

  it("保存値が範囲外なら既定値にフォールバックする", () => {
    expect(allocationRatioFor({ rent: 150 }, "rent")).toBe(100);
    expect(allocationRatioFor({ rent: 50.5 }, "rent")).toBe(100);
  });
});

describe("applyAllocation", () => {
  it("科目別内訳に按分後経費を付与する(元データは変えない)", () => {
    const breakdown = {
      sales: { income: 200_000, expense: 0 },
      rent: { income: 0, expense: 120_000 },
      supplies: { income: 0, expense: 10_001 },
    };
    const out = applyAllocation(breakdown, { rent: 50, supplies: 30 });

    expect(out.rent).toMatchObject({ ratio: 50, allocatedExpense: 60_000 });
    // 10_001 * 0.3 = 3_000.3 → 切り捨て
    expect(out.supplies).toMatchObject({ ratio: 30, allocatedExpense: 3_000 });
    // 未設定科目は100%
    expect(out.sales).toMatchObject({ ratio: 100, allocatedExpense: 0 });
    expect(breakdown.rent).toEqual({ income: 0, expense: 120_000 });
  });

  it("割合未指定なら按分後=支出額になる", () => {
    const out = applyAllocation(
      { rent: { income: 0, expense: 5_000 } },
      undefined,
    );
    expect(out.rent.allocatedExpense).toBe(5_000);
    expect(out.rent.ratio).toBe(100);
  });
});

describe("allocatedExpenseTotal", () => {
  it("按分後経費を合計する", () => {
    const entries = applyAllocation(
      {
        rent: { income: 0, expense: 120_000 },
        utilities: { income: 0, expense: 9_999 },
      },
      { rent: 50, utilities: 40 },
    );
    // 60_000 + 3_999 = 63_999
    expect(allocatedExpenseTotal(entries)).toBe(63_999);
    expect(allocatedExpenseTotal({})).toBe(0);
  });
});
