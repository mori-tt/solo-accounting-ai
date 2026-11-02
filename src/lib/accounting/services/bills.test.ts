import { describe, expect, it } from "vitest";
import { setupStore, seedClosedPeriod } from "../testing";
import {
  findUnpaidBills,
  registerBill,
  registerBillPayment,
  updateBill,
} from "./bills";

const billInput = {
  vendorName: "仕入先A",
  totalAmount: 110_000,
  receivedDate: "2025-06-10",
  dueDate: "2025-06-30",
  description: "6月分仕入",
};

async function seedBill() {
  const env = await setupStore();
  const { store, businessId, actor } = env;
  const { bill } = await registerBill(store, businessId, actor, {
    idempotencyKey: "bill-1",
    ...billInput,
  });
  return { ...env, bill };
}

describe("registerBill", () => {
  it("unpaid で登録する", async () => {
    const { store, businessId, bill } = await seedBill();
    expect(bill.status).toBe("unpaid");
    expect(bill.vendorName).toBe("仕入先A");
    const saved = await store.getBill(businessId, bill.id);
    expect(saved?.totalAmount).toBe(110_000);
  });

  it("取引先名・金額・日付の不正入力を拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await expect(
      registerBill(store, businessId, actor, {
        idempotencyKey: "b-novendor",
        ...billInput,
        vendorName: "",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      registerBill(store, businessId, actor, {
        idempotencyKey: "b-zero",
        ...billInput,
        totalAmount: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(
      registerBill(store, businessId, actor, {
        idempotencyKey: "b-date",
        ...billInput,
        receivedDate: "2025/06/10",
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATE" });
  });

  it("冪等キーの再実行で二重登録しない", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    const a = await registerBill(store, businessId, actor, {
      idempotencyKey: "bill-dup",
      ...billInput,
    });
    const b = await registerBill(store, businessId, actor, {
      idempotencyKey: "bill-dup",
      ...billInput,
    });
    expect(b.replayed).toBe(true);
    expect(b.bill.id).toBe(a.bill.id);
    expect(await store.listBills(businessId)).toHaveLength(1);
  });

  it("締め済み期間の受領日では登録できない", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await seedClosedPeriod(store, businessId, {
      id: "fy2025",
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    await expect(
      registerBill(store, businessId, actor, {
        idempotencyKey: "b-closed",
        ...billInput,
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
});

describe("updateBill", () => {
  it("未払の請求書を更新できる", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    const { bill: updated } = await updateBill(
      store,
      businessId,
      actor,
      bill.id,
      { ...billInput, totalAmount: 99_000, vendorName: "仕入先B" },
    );
    expect(updated.totalAmount).toBe(99_000);
    expect(updated.vendorName).toBe("仕入先B");
    expect(updated.createdAt).toBe(bill.createdAt);
  });

  it("支払済みの請求書は更新できない", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-full",
      billId: bill.id,
      date: "2025-06-20",
      amount: 110_000,
    });
    await expect(
      updateBill(store, businessId, actor, bill.id, {
        ...billInput,
        totalAmount: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  it("請求額を支払累計未満には下げられない", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-part",
      billId: bill.id,
      date: "2025-06-15",
      amount: 60_000,
    });
    await expect(
      updateBill(store, businessId, actor, bill.id, {
        ...billInput,
        totalAmount: 50_000,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    // 支払累計と同額以上への変更は可能
    const { bill: updated } = await updateBill(
      store,
      businessId,
      actor,
      bill.id,
      { ...billInput, totalAmount: 60_000 },
    );
    expect(updated.totalAmount).toBe(60_000);
  });

  it("存在しない請求書は NOT_FOUND", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await expect(
      updateBill(store, businessId, actor, "ghost", billInput),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("締め済み期間の受領日への変更を拒否する", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    await seedClosedPeriod(store, businessId, {
      id: "fy2024",
      fiscalYear: 2024,
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });
    await expect(
      updateBill(store, businessId, actor, bill.id, {
        ...billInput,
        receivedDate: "2024-06-10",
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
});

describe("registerBillPayment / 未払チェック", () => {
  it("部分支払ではunpaidのまま、全額でpaidになる", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    const first = await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-1",
      billId: bill.id,
      date: "2025-06-15",
      amount: 60_000,
    });
    expect(first.bill.status).toBe("unpaid");

    const second = await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-2",
      billId: bill.id,
      date: "2025-06-25",
      amount: 50_000,
    });
    expect(second.bill.status).toBe("paid");
    expect(second.payment.transactionId).toBeUndefined();
  });

  it("支出Transactionを紐付けられる", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    const { payment } = await registerBillPayment(
      store,
      businessId,
      actor,
      {
        idempotencyKey: "bp-tx",
        billId: bill.id,
        date: "2025-06-15",
        amount: 110_000,
        transactionId: "tx-1",
      },
    );
    expect(payment.transactionId).toBe("tx-1");
  });

  it("超過支払を拒否する", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-a",
      billId: bill.id,
      date: "2025-06-15",
      amount: 100_000,
    });
    await expect(
      registerBillPayment(store, businessId, actor, {
        idempotencyKey: "bp-b",
        billId: bill.id,
        date: "2025-06-16",
        amount: 10_001,
      }),
    ).rejects.toMatchObject({ code: "OVERPAID" });
  });

  it("支払済みbillへの追加支払を拒否する", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-full",
      billId: bill.id,
      date: "2025-06-15",
      amount: 110_000,
    });
    await expect(
      registerBillPayment(store, businessId, actor, {
        idempotencyKey: "bp-extra",
        billId: bill.id,
        date: "2025-06-16",
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_PAID" });
  });

  it("存在しないbillへの支払を拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await expect(
      registerBillPayment(store, businessId, actor, {
        idempotencyKey: "bp-ghost",
        billId: "ghost",
        date: "2025-06-15",
        amount: 1_000,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("支払の冪等リプレイは消込を重複しない", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    const a = await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-dup",
      billId: bill.id,
      date: "2025-06-15",
      amount: 110_000,
    });
    const b = await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-dup",
      billId: bill.id,
      date: "2025-06-15",
      amount: 110_000,
    });
    expect(b.replayed).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    const saved = await store.getBill(businessId, bill.id);
    expect(saved?.status).toBe("paid");
    expect(
      await store.listBillPaymentsForBill(businessId, bill.id),
    ).toHaveLength(1);
  });

  it("締め済み期間の日付の支払を拒否する", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    await seedClosedPeriod(store, businessId, {
      id: "fy2025h1",
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    });
    await expect(
      registerBillPayment(store, businessId, actor, {
        idempotencyKey: "bp-closed",
        billId: bill.id,
        date: "2025-06-15",
        amount: 100_000,
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    const ok = await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-ok",
      billId: bill.id,
      date: "2025-07-01",
      amount: 100_000,
    });
    expect(ok.payment.amount).toBe(100_000);
  });

  it("未払: 期日超過を overdue で検出し、期日昇順で返す", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    await registerBill(store, businessId, actor, {
      idempotencyKey: "bill-2",
      vendorName: "仕入先B",
      totalAmount: 20_000,
      receivedDate: "2025-06-05",
      dueDate: "2025-07-31",
    });
    await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-part",
      billId: bill.id,
      date: "2025-06-15",
      amount: 30_000,
    });
    const unpaid = await findUnpaidBills(store, businessId, "2025-07-01");
    // dueDate昇順: bill(2025-06-30) → bill-2(2025-07-31)
    expect(unpaid.map((u) => u.bill.dueDate)).toEqual([
      "2025-06-30",
      "2025-07-31",
    ]);
    expect(unpaid[0].bill.id).toBe(bill.id);
    expect(unpaid[0].remaining).toBe(80_000);
    expect(unpaid[0].overdue).toBe(true);
    expect(unpaid[1].overdue).toBe(false);
  });

  it("支払済みの請求書は未払検出に含めない", async () => {
    const { store, businessId, actor, bill } = await seedBill();
    await registerBillPayment(store, businessId, actor, {
      idempotencyKey: "bp-full",
      billId: bill.id,
      date: "2025-06-15",
      amount: 110_000,
    });
    expect(await findUnpaidBills(store, businessId, "2025-07-01")).toEqual([]);
  });
});
