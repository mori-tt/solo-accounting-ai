import { describe, expect, it } from "vitest";
import { setupStore, seedClosedPeriod } from "../testing";
import {
  findUnpaidInvoices,
  issueInvoice,
  refreshOverdueInvoices,
  registerCustomer,
  registerInvoice,
  registerPayment,
} from "./sales";

const items = [
  { description: "開発費", quantity: 2, unitPrice: 100_000, amount: 200_000 },
  { description: "保守", quantity: 1, unitPrice: 30_000, amount: 30_000 },
];

async function seedInvoice() {
  const env = await setupStore();
  const { store, businessId, actor } = env;
  const { customer } = await registerCustomer(store, businessId, actor, {
    id: "cust-1",
    name: "顧客A",
  });
  const { invoice } = await registerInvoice(store, businessId, actor, {
    idempotencyKey: "inv-1",
    customerId: customer.id,
    issueDate: "2025-06-01",
    dueDate: "2025-06-30",
    items,
  });
  await issueInvoice(store, businessId, actor, invoice.id);
  return { ...env, customer, invoice };
}

describe("registerInvoice", () => {
  it("items から合計を再計算して draft で登録する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    const { invoice } = await registerInvoice(store, businessId, actor, {
      idempotencyKey: "inv-calc",
      customerId: "c",
      issueDate: "2025-06-01",
      dueDate: "2025-06-30",
      items,
    });
    expect(invoice.totalAmount).toBe(230_000);
    expect(invoice.status).toBe("draft");
  });

  it("税率省略の明細は標準税率で税額を算出して保存する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    const { invoice } = await registerInvoice(store, businessId, actor, {
      idempotencyKey: "inv-tax",
      customerId: "c",
      issueDate: "2025-06-01",
      dueDate: "2025-06-30",
      items,
    });
    // 200,000円(10%) → 18,181 / 30,000円(10%) → 2,727
    expect(invoice.taxAmount).toBe(20_908);
    expect(invoice.items[0].taxRate).toBe("standard");
    expect(invoice.items[0].taxAmount).toBe(18_181);
    expect(invoice.items[1].taxAmount).toBe(2_727);
    const saved = await store.getInvoice(businessId, invoice.id);
    expect(saved?.taxAmount).toBe(20_908);
  });

  it("軽減税率8%の明細を混在できる", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    const { invoice } = await registerInvoice(store, businessId, actor, {
      idempotencyKey: "inv-tax-reduced",
      customerId: "c",
      issueDate: "2025-06-01",
      dueDate: "2025-06-30",
      items: [
        {
          description: "開発費",
          quantity: 2,
          unitPrice: 100_000,
          amount: 200_000,
          taxRate: "standard",
        },
        {
          description: "食料品",
          quantity: 1,
          unitPrice: 30_000,
          amount: 30_000,
          taxRate: "reduced",
        },
      ],
    });
    // 30,000円(8%) → floor(30,000×2/27) = 2,222
    expect(invoice.items[1].taxAmount).toBe(2_222);
    expect(invoice.taxAmount).toBe(18_181 + 2_222);
  });

  it("不正な税率区分を拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-tax-invalid",
        customerId: "c",
        issueDate: "2025-06-01",
        dueDate: "2025-06-30",
        items: [
          {
            description: "x",
            quantity: 1,
            unitPrice: 1_000,
            amount: 1_000,
            taxRate: "exempt" as never,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("明細の taxAmount 指定が再計算値と一致しなければ拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-item-tax",
        customerId: "c",
        issueDate: "2025-06-01",
        dueDate: "2025-06-30",
        items: [
          {
            description: "x",
            quantity: 1,
            unitPrice: 11_000,
            amount: 11_000,
            taxAmount: 1_100,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });

  it("taxAmount 指定が再計算値と一致しなければ拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-tax-mismatch",
        customerId: "c",
        issueDate: "2025-06-01",
        dueDate: "2025-06-30",
        items,
        taxAmount: 999,
      }),
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });

  it("totalAmount 指定が再計算値と一致しなければ拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-mismatch",
        customerId: "c",
        issueDate: "2025-06-01",
        dueDate: "2025-06-30",
        items,
        totalAmount: 999_999,
      }),
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });

  it("item.amount が quantity*unitPrice と一致しなければ拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-item",
        customerId: "c",
        issueDate: "2025-06-01",
        dueDate: "2025-06-30",
        items: [
          { description: "x", quantity: 2, unitPrice: 1_000, amount: 1_500 },
        ],
      }),
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });

  it("dueDate が issueDate より前なら拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-due",
        customerId: "c",
        issueDate: "2025-06-30",
        dueDate: "2025-06-01",
        items,
      }),
    ).rejects.toMatchObject({ code: "DUE_BEFORE_ISSUE" });
  });

  it("数量0・負の単価・空明細を拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-q0",
        customerId: "c",
        issueDate: "2025-06-01",
        dueDate: "2025-06-30",
        items: [{ description: "x", quantity: 0, unitPrice: 100, amount: 0 }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-neg",
        customerId: "c",
        issueDate: "2025-06-01",
        dueDate: "2025-06-30",
        items: [
          { description: "x", quantity: 1, unitPrice: -100, amount: -100 },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-empty",
        customerId: "c",
        issueDate: "2025-06-01",
        dueDate: "2025-06-30",
        items: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("存在しない顧客は NOT_FOUND", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await expect(
      registerInvoice(store, businessId, actor, {
        idempotencyKey: "inv-nocust",
        customerId: "ghost",
        issueDate: "2025-06-01",
        dueDate: "2025-06-30",
        items,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("冪等キーの再実行で二重登録しない", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    const a = await registerInvoice(store, businessId, actor, {
      idempotencyKey: "inv-dup",
      customerId: "c",
      issueDate: "2025-06-01",
      dueDate: "2025-06-30",
      items,
    });
    const b = await registerInvoice(store, businessId, actor, {
      idempotencyKey: "inv-dup",
      customerId: "c",
      issueDate: "2025-06-01",
      dueDate: "2025-06-30",
      items,
    });
    expect(b.replayed).toBe(true);
    expect(b.invoice.id).toBe(a.invoice.id);
    expect(await store.listInvoices(businessId)).toHaveLength(1);
  });
});

describe("registerPayment / 未入金チェック", () => {
  it("部分入金ではissuedのまま、全額でpaidになる", async () => {
    const { store, businessId, actor, invoice } = await seedInvoice();
    const first = await registerPayment(store, businessId, actor, {
      idempotencyKey: "pay-1",
      invoiceId: invoice.id,
      date: "2025-06-10",
      amount: 100_000,
    });
    expect(first.invoice.status).toBe("issued");

    const second = await registerPayment(store, businessId, actor, {
      idempotencyKey: "pay-2",
      invoiceId: invoice.id,
      date: "2025-06-20",
      amount: 130_000,
    });
    expect(second.invoice.status).toBe("paid");
  });

  it("超過入金を拒否する", async () => {
    const { store, businessId, actor, invoice } = await seedInvoice();
    await registerPayment(store, businessId, actor, {
      idempotencyKey: "pay-a",
      invoiceId: invoice.id,
      date: "2025-06-10",
      amount: 200_000,
    });
    await expect(
      registerPayment(store, businessId, actor, {
        idempotencyKey: "pay-b",
        invoiceId: invoice.id,
        date: "2025-06-11",
        amount: 30_001,
      }),
    ).rejects.toMatchObject({ code: "OVERPAID" });
  });

  it("支払済みinvoiceへの追加入金を拒否する", async () => {
    const { store, businessId, actor, invoice } = await seedInvoice();
    await registerPayment(store, businessId, actor, {
      idempotencyKey: "pay-full",
      invoiceId: invoice.id,
      date: "2025-06-10",
      amount: 230_000,
    });
    await expect(
      registerPayment(store, businessId, actor, {
        idempotencyKey: "pay-extra",
        invoiceId: invoice.id,
        date: "2025-06-11",
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "ALREADY_PAID" });
  });

  it("draftのinvoiceへの入金を拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    const { invoice } = await registerInvoice(store, businessId, actor, {
      idempotencyKey: "inv-draft",
      customerId: "c",
      issueDate: "2025-06-01",
      dueDate: "2025-06-30",
      items,
    });
    await expect(
      registerPayment(store, businessId, actor, {
        idempotencyKey: "pay-draft",
        invoiceId: invoice.id,
        date: "2025-06-10",
        amount: 1_000,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  it("入金の冪等リプレイは消込を重複しない", async () => {
    const { store, businessId, actor, invoice } = await seedInvoice();
    const a = await registerPayment(store, businessId, actor, {
      idempotencyKey: "pay-dup",
      invoiceId: invoice.id,
      date: "2025-06-10",
      amount: 230_000,
    });
    const b = await registerPayment(store, businessId, actor, {
      idempotencyKey: "pay-dup",
      invoiceId: invoice.id,
      date: "2025-06-10",
      amount: 230_000,
    });
    expect(b.replayed).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    const saved = await store.getInvoice(businessId, invoice.id);
    expect(saved?.status).toBe("paid");
    expect(
      await store.listPaymentsForInvoice(businessId, invoice.id),
    ).toHaveLength(1);
  });

  it("未入金: 期日超過を overdue で検出する", async () => {
    const { store, businessId, actor, invoice } = await seedInvoice();
    await registerPayment(store, businessId, actor, {
      idempotencyKey: "pay-part",
      invoiceId: invoice.id,
      date: "2025-06-10",
      amount: 30_000,
    });
    const unpaid = await findUnpaidInvoices(store, businessId, "2025-07-01");
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0].invoice.id).toBe(invoice.id);
    expect(unpaid[0].remaining).toBe(200_000);
    expect(unpaid[0].overdue).toBe(true);
    // 期日前なら overdue=false だが未入金としては検出される
    const early = await findUnpaidInvoices(store, businessId, "2025-06-15");
    expect(early[0].overdue).toBe(false);
  });

  it("refreshOverdueInvoices で issued→overdue に更新する", async () => {
    const { store, businessId, actor, invoice } = await seedInvoice();
    const { updated } = await refreshOverdueInvoices(
      store,
      businessId,
      actor,
      "2025-07-01",
    );
    expect(updated.map((i) => i.id)).toEqual([invoice.id]);
    const saved = await store.getInvoice(businessId, invoice.id);
    expect(saved?.status).toBe("overdue");
  });

  it("締め済み期間の日付の入金を拒否する", async () => {
    const { store, businessId, actor, invoice } = await seedInvoice();
    await seedClosedPeriod(store, businessId, {
      id: "fy2025h1",
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    });
    await expect(
      registerPayment(store, businessId, actor, {
        idempotencyKey: "pay-closed",
        invoiceId: invoice.id,
        date: "2025-06-15",
        amount: 100_000,
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    const ok = await registerPayment(store, businessId, actor, {
      idempotencyKey: "pay-ok",
      invoiceId: invoice.id,
      date: "2025-07-01",
      amount: 100_000,
    });
    expect(ok.payment.amount).toBe(100_000);
  });
});
