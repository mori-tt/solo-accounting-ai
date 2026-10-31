import { describe, expect, it } from "vitest";
import {
  buildClosingChecklist,
  findDuplicateCandidates,
  listUnpaidExpenses,
  listUnpaidInvoices,
} from "./checks";
import type {
  ExpenseEntity,
  FiscalPeriodEntity,
  InvoiceEntity,
  InvoiceStatus,
  PaymentEntity,
  ReceiptEntity,
  TransactionEntity,
  TransactionStatus,
  TransactionType,
} from "./types";

const NOW = new Date("2026-10-31T09:00:00.000Z");

function tx(
  id: string,
  overrides: Partial<TransactionEntity> = {},
): TransactionEntity {
  return {
    id,
    type: "expense" as TransactionType,
    date: "2026-10-15",
    amount: 10_000,
    account: "supplies",
    counterparty: "cp",
    description: "desc",
    receiptIds: [],
    status: "confirmed" as TransactionStatus,
    aiSuggestion: null,
    idempotencyKey: null,
    createdBy: "user",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function expense(
  id: string,
  overrides: Partial<ExpenseEntity> = {},
): ExpenseEntity {
  return {
    id,
    transactionId: id,
    taxCategory: "taxable",
    taxAmount: 1_000,
    paymentDueDate: null,
    paidAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function invoice(
  id: string,
  overrides: Partial<InvoiceEntity> = {},
): InvoiceEntity {
  return {
    id,
    customerId: "cust-1",
    projectId: null,
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    items: [{ description: "work", quantity: 1, unitPrice: 100_000, amount: 100_000 }],
    totalAmount: 100_000,
    status: "issued" as InvoiceStatus,
    idempotencyKey: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function payment(
  id: string,
  invoiceId: string,
  amount: number,
  date = "2026-10-15",
): PaymentEntity {
  return {
    id,
    invoiceId,
    date,
    amount,
    transactionId: null,
    idempotencyKey: null,
    createdAt: NOW,
  };
}

function receipt(id: string, status: ReceiptEntity["status"]): ReceiptEntity {
  return {
    id,
    storagePath: `receipts/biz/${id}/f.pdf`,
    fileName: "f.pdf",
    mimeType: "application/pdf",
    transactionId: null,
    status,
    aiSuggestion: null,
    idempotencyKey: null,
    createdBy: "user",
    createdAt: NOW,
  };
}

describe("listUnpaidInvoices", () => {
  const asOf = "2026-11-15";

  it("支払いのない発行済み請求書を未入金として返す", () => {
    const result = listUnpaidInvoices([invoice("inv-1")], [], asOf);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paidAmount: 0,
      outstandingAmount: 100_000,
      overdue: true,
      daysOverdue: 15,
    });
  });

  it("一部支払い済みは残額のみ未入金になる", () => {
    const result = listUnpaidInvoices(
      [invoice("inv-1")],
      [payment("p1", "inv-1", 40_000)],
      asOf,
    );
    expect(result[0].outstandingAmount).toBe(60_000);
    expect(result[0].paidAmount).toBe(40_000);
  });

  it("全額支払い済み・下書きは対象外", () => {
    const result = listUnpaidInvoices(
      [
        invoice("inv-1", { status: "paid" }),
        invoice("inv-2", { status: "draft" }),
      ],
      [payment("p1", "inv-1", 100_000)],
      asOf,
    );
    expect(result).toHaveLength(0);
  });

  it("期日前の請求書は未入金だが遅延ではない", () => {
    const result = listUnpaidInvoices(
      [invoice("inv-1", { dueDate: "2026-12-31" })],
      [],
      asOf,
    );
    expect(result[0].overdue).toBe(false);
    expect(result[0].daysOverdue).toBe(0);
  });

  it("overdueステータスも未入金として扱う", () => {
    const result = listUnpaidInvoices(
      [invoice("inv-1", { status: "overdue" })],
      [],
      asOf,
    );
    expect(result).toHaveLength(1);
  });
});

describe("listUnpaidExpenses", () => {
  const asOf = "2026-10-31";

  it("支払期限を過ぎた未払経費を返す", () => {
    const result = listUnpaidExpenses(
      [expense("e1", { paymentDueDate: "2026-10-01" })],
      [tx("e1")],
      asOf,
    );
    expect(result).toHaveLength(1);
    expect(result[0].overdue).toBe(true);
    expect(result[0].daysOverdue).toBe(30);
  });

  it("支払済み・期限未設定の経費は対象外", () => {
    const result = listUnpaidExpenses(
      [
        expense("e1", { paymentDueDate: "2026-10-01", paidAt: "2026-10-02" }),
        expense("e2"),
      ],
      [tx("e1"), tx("e2")],
      asOf,
    );
    expect(result).toHaveLength(0);
  });

  it("期限内の未払経費は遅延ではない", () => {
    const result = listUnpaidExpenses(
      [expense("e1", { paymentDueDate: "2026-11-30" })],
      [tx("e1")],
      asOf,
    );
    expect(result[0].overdue).toBe(false);
  });
});

describe("buildClosingChecklist", () => {
  const period = {
    id: "fy2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
    closedAt: null,
    closedBy: null,
    createdAt: NOW,
  } satisfies FiscalPeriodEntity;

  function check(overrides: {
    transactions?: TransactionEntity[];
    expenses?: ExpenseEntity[];
    invoices?: InvoiceEntity[];
    payments?: PaymentEntity[];
    receipts?: ReceiptEntity[];
  }) {
    return buildClosingChecklist({
      period,
      transactions: overrides.transactions ?? [],
      expenses: overrides.expenses ?? [],
      invoices: overrides.invoices ?? [],
      payments: overrides.payments ?? [],
      receipts: overrides.receipts ?? [],
    });
  }

  it("クリーンな状態ではready=trueになる", () => {
    const result = check({
      transactions: [
        tx("t1", { type: "income" }),
        tx("t2", { type: "expense", receiptIds: ["r1"] }),
      ],
    });
    expect(result.ready).toBe(true);
    expect(result.items.every((item) => item.count === 0)).toBe(true);
  });

  it("期間内のdraftはblockerになる", () => {
    const result = check({
      transactions: [
        tx("t1", { status: "draft" }),
        tx("t2", { status: "draft", date: "2027-01-10" }),
      ],
    });
    const item = result.items.find((i) => i.key === "draft_transactions");
    expect(item).toMatchObject({ severity: "blocker", count: 1, ids: ["t1"] });
    expect(result.ready).toBe(false);
  });

  it("証憑未添付の確定経費はwarningになる", () => {
    const result = check({
      transactions: [
        tx("t1", { type: "expense" }),
        tx("t2", { type: "expense", receiptIds: ["r1"] }),
        tx("t3", { type: "income" }),
      ],
    });
    const item = result.items.find((i) => i.key === "unattached_receipts");
    expect(item).toMatchObject({ severity: "warning", count: 1, ids: ["t1"] });
  });

  it("未払経費と未入金請求を警告する", () => {
    const result = check({
      transactions: [tx("e1")],
      expenses: [expense("e1", { paymentDueDate: "2026-12-01" })],
      invoices: [invoice("inv-1")],
    });
    expect(
      result.items.find((i) => i.key === "unpaid_expenses"),
    ).toMatchObject({ count: 1, ids: ["e1"] });
    expect(
      result.items.find((i) => i.key === "unpaid_invoices"),
    ).toMatchObject({ count: 1, ids: ["inv-1"] });
  });

  it("未処理の証憑を警告する", () => {
    const result = check({
      receipts: [receipt("r1", "unprocessed"), receipt("r2", "archived")],
    });
    expect(
      result.items.find((i) => i.key === "unprocessed_receipts"),
    ).toMatchObject({ count: 1, ids: ["r1"] });
  });
});

describe("findDuplicateCandidates", () => {
  it("同日・同額の取引を候補として返す", () => {
    const target = tx("t1", { date: "2026-10-15", amount: 5_000 });
    const candidates = [
      tx("t2", { date: "2026-10-15", amount: 5_000, counterparty: "cp" }),
      tx("t3", { date: "2026-10-16", amount: 5_000 }),
      tx("t4", { date: "2026-10-15", amount: 6_000 }),
    ];
    const result = findDuplicateCandidates(target, candidates);
    expect(result).toHaveLength(1);
    expect(result[0].transaction.id).toBe("t2");
    expect(result[0].sameCounterparty).toBe(true);
  });
});
