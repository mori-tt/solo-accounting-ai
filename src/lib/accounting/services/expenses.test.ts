import { describe, expect, it } from "vitest";
import { setupStore, seedClosedPeriod } from "../testing";
import {
  findUnpaidExpenses,
  markExpensePaid,
  registerExpense,
} from "./expenses";
import { confirmTransaction } from "./transactions";

const base = {
  date: "2025-06-10",
  amount: 12_000,
  account: "supplies",
  counterparty: "文具店",
  taxCategory: "taxable" as const,
  taxAmount: 1_091,
};

describe("registerExpense", () => {
  it("TransactionとExpenseを同時に作成する", async () => {
    const { store, businessId, actor } = await setupStore();
    const { transaction, expense, replayed } = await registerExpense(
      store,
      businessId,
      actor,
      { idempotencyKey: "exp-1", ...base },
    );
    expect(replayed).toBe(false);
    expect(transaction.type).toBe("expense");
    expect(transaction.status).toBe("draft");
    expect(expense.transactionId).toBe(transaction.id);
    expect(expense.taxAmount).toBe(1_091);
    expect(expense.paidAt).toBeUndefined();
  });

  it("0円・負の金額を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      registerExpense(store, businessId, actor, {
        idempotencyKey: "exp-zero",
        ...base,
        amount: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(
      registerExpense(store, businessId, actor, {
        idempotencyKey: "exp-neg",
        ...base,
        amount: -500,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("負の税額を拒否し、0円は許容する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      registerExpense(store, businessId, actor, {
        idempotencyKey: "exp-tax-neg",
        ...base,
        taxAmount: -1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    const { expense } = await registerExpense(store, businessId, actor, {
      idempotencyKey: "exp-tax-zero",
      ...base,
      taxCategory: "non_taxable",
      taxAmount: 0,
    });
    expect(expense.taxAmount).toBe(0);
  });

  it("冪等キーの再実行で二重登録しない", async () => {
    const { store, businessId, actor } = await setupStore();
    const first = await registerExpense(store, businessId, actor, {
      idempotencyKey: "exp-dup",
      ...base,
    });
    const second = await registerExpense(store, businessId, actor, {
      idempotencyKey: "exp-dup",
      ...base,
    });
    expect(second.replayed).toBe(true);
    expect(second.expense.id).toBe(first.expense.id);
    expect(await store.listExpenses(businessId)).toHaveLength(1);
  });
});

describe("未払チェック / markExpensePaid", () => {
  async function seed() {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    // 期日超過の未払
    const overdue = await registerExpense(store, businessId, actor, {
      idempotencyKey: "exp-od",
      ...base,
      paymentDueDate: "2025-06-01",
    });
    // 期日が未来の未払
    const upcoming = await registerExpense(store, businessId, actor, {
      idempotencyKey: "exp-up",
      ...base,
      paymentDueDate: "2025-07-01",
    });
    // 支払い済み
    const paid = await registerExpense(store, businessId, actor, {
      idempotencyKey: "exp-paid",
      ...base,
      paymentDueDate: "2025-06-01",
    });
    await markExpensePaid(
      store,
      businessId,
      actor,
      paid.expense.id,
      "2025-05-30",
    );
    return { ...env, overdue, upcoming, paid };
  }

  it("未払のみ検出し、期日超過を overdue=true で返す", async () => {
    const { store, businessId, overdue, upcoming, paid } = await seed();
    const unpaid = await findUnpaidExpenses(store, businessId, "2025-06-15");
    const ids = unpaid.map((u) => u.expense.id);
    expect(ids).toContain(overdue.expense.id);
    expect(ids).toContain(upcoming.expense.id);
    expect(ids).not.toContain(paid.expense.id);

    const byId = new Map(unpaid.map((u) => [u.expense.id, u]));
    expect(byId.get(overdue.expense.id)?.overdue).toBe(true);
    expect(byId.get(upcoming.expense.id)?.overdue).toBe(false);
  });

  it("paidAt を記録すると未払から外れる", async () => {
    const { store, businessId, actor, overdue } = await seed();
    const { expense } = await markExpensePaid(
      store,
      businessId,
      actor,
      overdue.expense.id,
      "2025-06-20",
    );
    expect(expense.paidAt).toBe("2025-06-20");
    const unpaid = await findUnpaidExpenses(store, businessId, "2025-06-30");
    expect(unpaid.map((u) => u.expense.id)).not.toContain(overdue.expense.id);
  });

  it("同じ paidAt の再実行は冪等、別日付は ALREADY_PAID", async () => {
    const { store, businessId, actor, upcoming } = await seed();
    await markExpensePaid(store, businessId, actor, upcoming.expense.id, "2025-06-20");
    const again = await markExpensePaid(
      store,
      businessId,
      actor,
      upcoming.expense.id,
      "2025-06-20",
    );
    expect(again.expense.paidAt).toBe("2025-06-20");
    await expect(
      markExpensePaid(store, businessId, actor, upcoming.expense.id, "2025-06-21"),
    ).rejects.toMatchObject({ code: "ALREADY_PAID" });
  });

  it("締め済み期間の取引に紐付く経費は支払記録を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    const { expense } = await registerExpense(store, businessId, actor, {
      idempotencyKey: "exp-lock",
      ...base,
      date: "2024-11-10",
    });
    await seedClosedPeriod(store, businessId, {
      id: "fy2024",
      fiscalYear: 2024,
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });
    // transaction自体をlocked相当として保護する(締め済み期間のtxn日付)
    const txn = await store.getTransaction(businessId, expense.transactionId);
    expect(txn?.date).toBe("2024-11-10");
    await expect(
      markExpensePaid(store, businessId, actor, expense.id, "2025-01-10"),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("取引が締め済み期間に属する場合、支払日が期間外でも拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    const { expense } = await registerExpense(store, businessId, actor, {
      idempotencyKey: "exp-lock2",
      ...base,
      date: "2025-06-10",
    });
    await confirmTransaction(store, businessId, actor, expense.transactionId);
    await seedClosedPeriod(store, businessId, {
      id: "fy2025h1",
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    });
    // paidAt が期間内でも期間外でも、締め済み期間のデータは変更不可
    await expect(
      markExpensePaid(store, businessId, actor, expense.id, "2025-06-25"),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    await expect(
      markExpensePaid(store, businessId, actor, expense.id, "2025-07-05"),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("支払日が別の締め済み期間に入る場合も拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    const { expense } = await registerExpense(store, businessId, actor, {
      idempotencyKey: "exp-open",
      ...base,
      date: "2025-07-10",
    });
    await seedClosedPeriod(store, businessId, {
      id: "fy2025h1",
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    });
    await expect(
      markExpensePaid(store, businessId, actor, expense.id, "2025-06-25"),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    // オープン期間の支払日なら記録できる
    const ok = await markExpensePaid(
      store,
      businessId,
      actor,
      expense.id,
      "2025-08-05",
    );
    expect(ok.expense.paidAt).toBe("2025-08-05");
  });
});
