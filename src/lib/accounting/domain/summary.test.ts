import { describe, expect, it } from "vitest";
import { computeMonthlySummary } from "./summary";
import type {
  TransactionEntity,
  TransactionStatus,
  TransactionType,
} from "./types";

const NOW = new Date("2026-10-31T09:00:00.000Z");

function tx(
  id: string,
  type: TransactionType,
  date: string,
  amount: number,
  account = "sales",
  status: TransactionStatus = "confirmed",
): TransactionEntity {
  return {
    id,
    type,
    date,
    amount,
    account,
    counterparty: "cp",
    description: "desc",
    receiptIds: [],
    status,
    aiSuggestion: null,
    idempotencyKey: null,
    createdBy: "user",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("computeMonthlySummary", () => {
  it("confirmed取引の収入・費用を集計する", () => {
    const summary = computeMonthlySummary(
      "2026-10",
      [
        tx("t1", "income", "2026-10-05", 100_000),
        tx("t2", "income", "2026-10-20", 50_000),
        tx("t3", "expense", "2026-10-10", 30_000, "rent"),
      ],
      NOW,
    );
    expect(summary.totalIncome).toBe(150_000);
    expect(summary.totalExpense).toBe(30_000);
    expect(summary.transactionCount).toBe(3);
  });

  it("draft取引は集計対象外になる", () => {
    const summary = computeMonthlySummary(
      "2026-10",
      [
        tx("t1", "income", "2026-10-05", 100_000, "sales", "draft"),
        tx("t2", "income", "2026-10-06", 20_000),
      ],
      NOW,
    );
    expect(summary.totalIncome).toBe(20_000);
    expect(summary.transactionCount).toBe(1);
  });

  it("locked取引も集計対象になる", () => {
    const summary = computeMonthlySummary(
      "2026-10",
      [tx("t1", "income", "2026-10-05", 100_000, "sales", "locked")],
      NOW,
    );
    expect(summary.totalIncome).toBe(100_000);
  });

  it("月末と翌月1日は別月に集計される", () => {
    const transactions = [
      tx("t1", "income", "2026-01-31", 10_000),
      tx("t2", "income", "2026-02-01", 20_000),
      tx("t3", "expense", "2028-02-29", 5_000, "supplies"),
    ];
    const jan = computeMonthlySummary("2026-01", transactions, NOW);
    const feb = computeMonthlySummary("2026-02", transactions, NOW);
    const leapFeb = computeMonthlySummary("2028-02", transactions, NOW);
    expect(jan.totalIncome).toBe(10_000);
    expect(feb.totalIncome).toBe(20_000);
    expect(leapFeb.totalExpense).toBe(5_000);
  });

  it("科目別内訳を構築する", () => {
    const summary = computeMonthlySummary(
      "2026-10",
      [
        tx("t1", "income", "2026-10-05", 100_000, "sales"),
        tx("t2", "expense", "2026-10-06", 10_000, "rent"),
        tx("t3", "expense", "2026-10-07", 5_000, "rent"),
        tx("t4", "income", "2026-10-08", 3_000, "misc"),
      ],
      NOW,
    );
    expect(summary.accountBreakdown).toEqual({
      sales: { income: 100_000, expense: 0 },
      rent: { income: 0, expense: 15_000 },
      misc: { income: 3_000, expense: 0 },
    });
  });

  it("transferは収支に含めない", () => {
    const summary = computeMonthlySummary(
      "2026-10",
      [tx("t1", "transfer", "2026-10-05", 40_000, "bank")],
      NOW,
    );
    expect(summary.totalIncome).toBe(0);
    expect(summary.totalExpense).toBe(0);
    expect(summary.accountBreakdown).toEqual({});
  });

  it("対象取引がなくても0の集計を返す", () => {
    const summary = computeMonthlySummary("2026-10", [], NOW);
    expect(summary).toMatchObject({
      id: "2026-10",
      totalIncome: 0,
      totalExpense: 0,
      transactionCount: 0,
    });
  });
});
