import { describe, expect, it } from "vitest";
import {
  ACTOR,
  BIZ,
  expectDomainError,
  setup,
} from "./test-helpers";
import type { ExpenseInput, InvoiceInput } from "./domain/validate";

function expenseInput(
  overrides: Partial<ExpenseInput> = {},
): ExpenseInput {
  return {
    type: "expense",
    date: "2026-10-15",
    amount: 11_000,
    account: "supplies",
    counterparty: "vendor-a",
    description: "office supplies",
    taxCategory: "taxable",
    taxAmount: 1_000,
    ...overrides,
  };
}

function invoiceInput(
  customerId: string,
  overrides: Partial<InvoiceInput> = {},
): InvoiceInput {
  return {
    customerId,
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    items: [
      { description: "development", quantity: 2, unitPrice: 50_000, amount: 100_000 },
    ],
    ...overrides,
  };
}

describe("registerExpense", () => {
  it("経費取引と経費レコードを同時に登録する", async () => {
    const { service } = setup();
    const { transaction, expense } = await service.registerExpense(
      BIZ,
      expenseInput(),
      ACTOR,
    );
    expect(transaction.type).toBe("expense");
    expect(expense.transactionId).toBe(transaction.id);
    expect(expense.taxAmount).toBe(1_000);
    expect(expense.paidAt).toBeNull();
  });

  it("金額0円・負の金額を拒否する", async () => {
    const { service } = setup();
    await expectDomainError(
      service.registerExpense(BIZ, expenseInput({ amount: 0 }), ACTOR),
      "INVALID_AMOUNT",
    );
    await expectDomainError(
      service.registerExpense(BIZ, expenseInput({ amount: -1 }), ACTOR),
      "INVALID_AMOUNT",
    );
  });

  it("消費税額が支払額を超える場合を拒否する", async () => {
    const { service } = setup();
    await expectDomainError(
      service.registerExpense(
        BIZ,
        expenseInput({ amount: 1_000, taxAmount: 2_000 }),
        ACTOR,
      ),
      "VALIDATION_FAILED",
    );
  });

  it("冪等キーの再送は二重登録しない", async () => {
    const { service, store } = setup();
    const first = await service.registerExpense(
      BIZ,
      { ...expenseInput(), idempotencyKey: "exp-1" },
      ACTOR,
    );
    const second = await service.registerExpense(
      BIZ,
      { ...expenseInput(), idempotencyKey: "exp-1" },
      ACTOR,
    );
    expect(second.deduplicated).toBe(true);
    expect(second.expense.id).toBe(first.expense.id);
    expect(await store.list(BIZ, "expenses")).toHaveLength(1);
  });
});

describe("未払チェック", () => {
  it("支払期限を過ぎた未払経費を検出する", async () => {
    const { service } = setup();
    await service.registerExpense(
      BIZ,
      expenseInput({ paymentDueDate: "2026-10-01" }),
      ACTOR,
    );
    const unpaid = await service.getUnpaidExpenses(BIZ, "2026-10-31");
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0].overdue).toBe(true);
    expect(unpaid[0].daysOverdue).toBe(30);
  });

  it("支払記録で未払が解消する", async () => {
    const { service } = setup();
    const { expense } = await service.registerExpense(
      BIZ,
      expenseInput({ paymentDueDate: "2026-10-01" }),
      ACTOR,
    );
    const paid = await service.markExpensePaid(
      BIZ,
      expense.id,
      "2026-10-20",
      ACTOR,
    );
    expect(paid.paidAt).toBe("2026-10-20");
    expect(await service.getUnpaidExpenses(BIZ, "2026-10-31")).toHaveLength(0);
  });

  it("期限未設定の経費は未払に含めない", async () => {
    const { service } = setup();
    await service.registerExpense(BIZ, expenseInput(), ACTOR);
    expect(await service.getUnpaidExpenses(BIZ, "2026-10-31")).toHaveLength(0);
  });
});

describe("売上・請求フロー", () => {
  async function issueInvoice(service: ReturnType<typeof setup>["service"]) {
    const customer = await service.registerCustomer(
      BIZ,
      { name: "client-a" },
      ACTOR,
    );
    const { invoice } = await service.registerInvoice(
      BIZ,
      invoiceInput(customer.id),
      ACTOR,
    );
    await service.issueInvoice(BIZ, invoice.id, ACTOR);
    return { customer, invoice };
  }

  it("請求書を発行して入金を消込する", async () => {
    const { service } = setup();
    const { invoice } = await issueInvoice(service);

    const partial = await service.recordPayment(
      BIZ,
      { invoiceId: invoice.id, date: "2026-10-20", amount: 40_000 },
      ACTOR,
    );
    expect(partial.invoice.status).toBe("issued");

    const full = await service.recordPayment(
      BIZ,
      { invoiceId: invoice.id, date: "2026-10-25", amount: 60_000 },
      ACTOR,
    );
    expect(full.invoice.status).toBe("paid");
    expect(await service.getUnpaidInvoices(BIZ, "2026-11-15")).toHaveLength(0);
  });

  it("未入金の発行済み請求書を検出する", async () => {
    const { service } = setup();
    const { invoice } = await issueInvoice(service);
    const unpaid = await service.getUnpaidInvoices(BIZ, "2026-11-15");
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0].invoice.id).toBe(invoice.id);
    expect(unpaid[0].overdue).toBe(true);
    expect(unpaid[0].daysOverdue).toBe(15);
    expect(unpaid[0].outstandingAmount).toBe(100_000);
  });

  it("一部入金は残額のみ未入金にする", async () => {
    const { service } = setup();
    const { invoice } = await issueInvoice(service);
    await service.recordPayment(
      BIZ,
      { invoiceId: invoice.id, date: "2026-10-20", amount: 30_000 },
      ACTOR,
    );
    const unpaid = await service.getUnpaidInvoices(BIZ, "2026-11-15");
    expect(unpaid[0].outstandingAmount).toBe(70_000);
  });

  it("残額を超える入金を拒否する", async () => {
    const { service } = setup();
    const { invoice } = await issueInvoice(service);
    await expectDomainError(
      service.recordPayment(
        BIZ,
        { invoiceId: invoice.id, date: "2026-10-20", amount: 100_001 },
        ACTOR,
      ),
      "PAYMENT_EXCEEDS_BALANCE",
    );
  });

  it("draft請求書への入金を拒否する", async () => {
    const { service } = setup();
    const customer = await service.registerCustomer(
      BIZ,
      { name: "client-a" },
      ACTOR,
    );
    const { invoice } = await service.registerInvoice(
      BIZ,
      invoiceInput(customer.id),
      ACTOR,
    );
    await expectDomainError(
      service.recordPayment(
        BIZ,
        { invoiceId: invoice.id, date: "2026-10-20", amount: 1_000 },
        ACTOR,
      ),
      "INVALID_STATE",
    );
  });

  it("入金の冪等キー再送は二重計上しない", async () => {
    const { service, store } = setup();
    const { invoice } = await issueInvoice(service);
    const input = {
      invoiceId: invoice.id,
      date: "2026-10-20" as const,
      amount: 40_000,
      idempotencyKey: "pay-1",
    };
    await service.recordPayment(BIZ, input, ACTOR);
    const second = await service.recordPayment(BIZ, input, ACTOR);
    expect(second.deduplicated).toBe(true);
    expect(await store.list(BIZ, "payments")).toHaveLength(1);
  });

  it("金額0円・負の入金を拒否する", async () => {
    const { service } = setup();
    const { invoice } = await issueInvoice(service);
    await expectDomainError(
      service.recordPayment(
        BIZ,
        { invoiceId: invoice.id, date: "2026-10-20", amount: 0 },
        ACTOR,
      ),
      "INVALID_AMOUNT",
    );
    await expectDomainError(
      service.recordPayment(
        BIZ,
        { invoiceId: invoice.id, date: "2026-10-20", amount: -10_000 },
        ACTOR,
      ),
      "INVALID_AMOUNT",
    );
  });

  it("明細の合計と総額の不整合・0円請求を拒否する", async () => {
    const { service } = setup();
    const customer = await service.registerCustomer(
      BIZ,
      { name: "client-a" },
      ACTOR,
    );
    await expectDomainError(
      service.registerInvoice(
        BIZ,
        invoiceInput(customer.id, {
          items: [
            { description: "x", quantity: 1, unitPrice: 1_000, amount: 2_000 },
          ],
        }),
        ACTOR,
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      service.registerInvoice(
        BIZ,
        invoiceInput(customer.id, {
          items: [
            { description: "x", quantity: 1, unitPrice: 0, amount: 0 },
          ],
        }),
        ACTOR,
      ),
      "INVALID_AMOUNT",
    );
    await expectDomainError(
      service.registerInvoice(
        BIZ,
        invoiceInput(customer.id, { items: [] }),
        ACTOR,
      ),
      "VALIDATION_FAILED",
    );
  });

  it("存在しない顧客への請求を拒否する", async () => {
    const { service } = setup();
    await expectDomainError(
      service.registerInvoice(BIZ, invoiceInput("no-such-customer"), ACTOR),
      "NOT_FOUND",
    );
  });

  it("期日を過ぎた発行済み請求書をoverdueに更新する", async () => {
    const { service } = setup();
    const { invoice } = await issueInvoice(service);
    const updated = await service.refreshInvoiceStatuses(BIZ, "2026-11-15");
    expect(updated.map((i) => i.id)).toEqual([invoice.id]);
    expect(updated[0].status).toBe("overdue");
  });
});

describe("領収書ステータス管理", () => {
  async function registerReceiptAndTx(service: ReturnType<typeof setup>["service"]) {
    const { receipt } = await service.registerReceipt(
      BIZ,
      {
        storagePath: `receipts/${BIZ}/r1/f.pdf`,
        fileName: "f.pdf",
        mimeType: "application/pdf",
      },
      ACTOR,
    );
    const { transaction } = await service.registerTransaction(
      BIZ,
      {
        type: "expense",
        date: "2026-10-15",
        amount: 8_000,
        account: "supplies",
        counterparty: "store",
        description: "tools",
      },
      ACTOR,
    );
    return { receipt, transaction };
  }

  it("unprocessed → linked に遷移し取引へ紐付く", async () => {
    const { service } = setup();
    const { receipt, transaction } = await registerReceiptAndTx(service);
    const result = await service.linkReceipt(
      BIZ,
      receipt.id,
      transaction.id,
      ACTOR,
    );
    expect(result.receipt.status).toBe("linked");
    expect(result.receipt.transactionId).toBe(transaction.id);
    expect(result.transaction.receiptIds).toEqual([receipt.id]);
  });

  it("同じ取引への再紐付けは冪等に扱う", async () => {
    const { service } = setup();
    const { receipt, transaction } = await registerReceiptAndTx(service);
    await service.linkReceipt(BIZ, receipt.id, transaction.id, ACTOR);
    const again = await service.linkReceipt(
      BIZ,
      receipt.id,
      transaction.id,
      ACTOR,
    );
    expect(again.transaction.receiptIds).toEqual([receipt.id]);
  });

  it("linked状態から別取引への紐付けを拒否する", async () => {
    const { service } = setup();
    const { receipt, transaction } = await registerReceiptAndTx(service);
    const other = await service.registerTransaction(
      BIZ,
      {
        type: "expense",
        date: "2026-10-16",
        amount: 3_000,
        account: "supplies",
        counterparty: "store",
        description: "other",
      },
      ACTOR,
    );
    await service.linkReceipt(BIZ, receipt.id, transaction.id, ACTOR);
    await expectDomainError(
      service.linkReceipt(BIZ, receipt.id, other.transaction.id, ACTOR),
      "INVALID_STATE",
    );
  });

  it("linked → unprocessed に戻せる", async () => {
    const { service, store } = setup();
    const { receipt, transaction } = await registerReceiptAndTx(service);
    await service.linkReceipt(BIZ, receipt.id, transaction.id, ACTOR);
    const unlinked = await service.unlinkReceipt(BIZ, receipt.id, ACTOR);
    expect(unlinked.status).toBe("unprocessed");
    expect(unlinked.transactionId).toBeNull();
    const tx = await store.get(BIZ, "transactions", transaction.id);
    expect(tx?.receiptIds).toEqual([]);
  });

  it("linked → archived にすると紐付けが外れる", async () => {
    const { service, store } = setup();
    const { receipt, transaction } = await registerReceiptAndTx(service);
    await service.linkReceipt(BIZ, receipt.id, transaction.id, ACTOR);
    const archived = await service.archiveReceipt(BIZ, receipt.id, ACTOR);
    expect(archived.status).toBe("archived");
    const tx = await store.get(BIZ, "transactions", transaction.id);
    expect(tx?.receiptIds).toEqual([]);
  });

  it("archivedからの遷移を拒否する", async () => {
    const { service } = setup();
    const { receipt, transaction } = await registerReceiptAndTx(service);
    await service.archiveReceipt(BIZ, receipt.id, ACTOR);
    await expectDomainError(
      service.linkReceipt(BIZ, receipt.id, transaction.id, ACTOR),
      "INVALID_STATE",
    );
    await expectDomainError(
      service.archiveReceipt(BIZ, receipt.id, ACTOR),
      "INVALID_STATE",
    );
  });
});
