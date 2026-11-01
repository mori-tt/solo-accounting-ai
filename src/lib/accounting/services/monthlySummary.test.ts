import { describe, expect, it } from "vitest";
import { setupStore } from "../testing";
import type { Transaction } from "../types";
import {
  computeMonthlySummary,
  recomputeMonthlySummary,
} from "./monthlySummary";
import {
  confirmTransaction,
  registerTransaction,
} from "./transactions";

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: "t",
    type: "income",
    date: "2025-06-10",
    amount: 1,
    account: "sales",
    counterparty: "",
    description: "",
    receiptIds: [],
    status: "confirmed",
    createdBy: "u",
    createdAt: "2025-06-10T00:00:00.000Z",
    updatedAt: "2025-06-10T00:00:00.000Z",
    ...partial,
  };
}

describe("computeMonthlySummary(純粋関数)", () => {
  it("収入・経費と科目別集計を返す", () => {
    const summary = computeMonthlySummary(
      "202506",
      [
        txn({ id: "a", amount: 100_000, account: "sales" }),
        txn({ id: "b", amount: 50_000, account: "sales" }),
        txn({
          id: "c",
          type: "expense",
          amount: 20_000,
          account: "supplies",
        }),
      ],
      "2025-06-30T00:00:00.000Z",
    );
    expect(summary.totalIncome).toBe(150_000);
    expect(summary.totalExpense).toBe(20_000);
    expect(summary.accountBreakdown).toEqual({
      sales: { income: 150_000, expense: 0 },
      supplies: { income: 0, expense: 20_000 },
    });
  });

  it("draft は集計に含めない", () => {
    const summary = computeMonthlySummary(
      "202506",
      [txn({ id: "a", amount: 100_000, status: "draft" })],
      "2025-06-30T00:00:00.000Z",
    );
    expect(summary.totalIncome).toBe(0);
  });

  it("月をまたぐ取引は含めない(月末境界)", () => {
    const summary = computeMonthlySummary(
      "202503",
      [
        txn({ id: "mar", date: "2025-03-31", amount: 100 }),
        txn({ id: "apr", date: "2025-04-01", amount: 200 }),
      ],
      "2025-04-01T00:00:00.000Z",
    );
    expect(summary.totalIncome).toBe(100);
  });
});

describe("recomputeMonthlySummary", () => {
  it("確定取引から月次サマリを保存する", async () => {
    const { store, businessId, actor } = await setupStore();
    const { transaction } = await registerTransaction(
      store,
      businessId,
      actor,
      {
        idempotencyKey: "tx-m1",
        type: "income",
        date: "2025-06-10",
        amount: 80_000,
        account: "sales",
      },
    );
    await confirmTransaction(store, businessId, actor, transaction.id);
    // draft は含まれない
    await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-m2",
      type: "income",
      date: "2025-06-11",
      amount: 999_999,
      account: "sales",
    });

    const { summary } = await recomputeMonthlySummary(
      store,
      businessId,
      actor,
      "202506",
    );
    expect(summary.month).toBe("202506");
    expect(summary.totalIncome).toBe(80_000);
    expect(summary.totalExpense).toBe(0);

    const saved = await store.getMonthlySummary(businessId, "202506");
    expect(saved?.totalIncome).toBe(80_000);
  });

  it("再実行は再計算し直す(derived data)", async () => {
    const { store, businessId, actor } = await setupStore();
    await recomputeMonthlySummary(store, businessId, actor, "202506");
    const { transaction } = await registerTransaction(
      store,
      businessId,
      actor,
      {
        idempotencyKey: "tx-m3",
        type: "expense",
        date: "2025-06-20",
        amount: 10_000,
        account: "rent",
      },
    );
    await confirmTransaction(store, businessId, actor, transaction.id);
    const { summary } = await recomputeMonthlySummary(
      store,
      businessId,
      actor,
      "202506",
    );
    expect(summary.totalExpense).toBe(10_000);
  });

  it("不正な月キーを拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      recomputeMonthlySummary(store, businessId, actor, "202513"),
    ).rejects.toMatchObject({ code: "INVALID_DATE" });
    await expect(
      recomputeMonthlySummary(store, businessId, actor, "2025-06"),
    ).rejects.toMatchObject({ code: "INVALID_DATE" });
  });
});
