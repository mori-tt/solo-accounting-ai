import {
  assertISODate,
  daysBetween,
  isWithinRange,
  type ISODate,
} from "./dates";
import type {
  ExpenseEntity,
  FiscalPeriodEntity,
  InvoiceEntity,
  PaymentEntity,
  ReceiptEntity,
  TransactionEntity,
} from "./types";

export interface UnpaidInvoiceInfo {
  invoice: InvoiceEntity;
  paidAmount: number;
  outstandingAmount: number;
  overdue: boolean;
  daysOverdue: number;
}

export function paidAmountForInvoice(
  invoiceId: string,
  payments: readonly PaymentEntity[],
): number {
  return payments
    .filter((payment) => payment.invoiceId === invoiceId)
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export function listUnpaidInvoices(
  invoices: readonly InvoiceEntity[],
  payments: readonly PaymentEntity[],
  asOf: ISODate,
): UnpaidInvoiceInfo[] {
  assertISODate(asOf, "asOf");
  const result: UnpaidInvoiceInfo[] = [];
  for (const invoice of invoices) {
    if (invoice.status !== "issued" && invoice.status !== "overdue") continue;
    const paidAmount = paidAmountForInvoice(invoice.id, payments);
    const outstandingAmount = invoice.totalAmount - paidAmount;
    if (outstandingAmount <= 0) continue;
    const overdue = invoice.dueDate < asOf;
    result.push({
      invoice,
      paidAmount,
      outstandingAmount,
      overdue,
      daysOverdue: overdue ? daysBetween(invoice.dueDate, asOf) : 0,
    });
  }
  return result.sort((a, b) => (a.invoice.dueDate < b.invoice.dueDate ? -1 : 1));
}

export interface UnpaidExpenseInfo {
  expense: ExpenseEntity;
  transaction: TransactionEntity;
  overdue: boolean;
  daysOverdue: number;
}

export function listUnpaidExpenses(
  expenses: readonly ExpenseEntity[],
  transactions: readonly TransactionEntity[],
  asOf: ISODate,
): UnpaidExpenseInfo[] {
  assertISODate(asOf, "asOf");
  const transactionById = new Map(transactions.map((tx) => [tx.id, tx]));
  const result: UnpaidExpenseInfo[] = [];
  for (const expense of expenses) {
    if (expense.paidAt !== null || expense.paymentDueDate === null) continue;
    const transaction = transactionById.get(expense.transactionId);
    if (!transaction) continue;
    const overdue = expense.paymentDueDate < asOf;
    result.push({
      expense,
      transaction,
      overdue,
      daysOverdue: overdue ? daysBetween(expense.paymentDueDate, asOf) : 0,
    });
  }
  return result.sort((a, b) => {
    const dueA = a.expense.paymentDueDate ?? "";
    const dueB = b.expense.paymentDueDate ?? "";
    return dueA < dueB ? -1 : 1;
  });
}

export type ChecklistSeverity = "blocker" | "warning";

export interface ClosingChecklistItem {
  key:
    | "draft_transactions"
    | "unattached_receipts"
    | "unpaid_expenses"
    | "unpaid_invoices"
    | "unprocessed_receipts";
  severity: ChecklistSeverity;
  count: number;
  ids: string[];
}

export interface ClosingChecklist {
  periodId: string;
  ready: boolean;
  items: ClosingChecklistItem[];
}

export function buildClosingChecklist(input: {
  period: FiscalPeriodEntity;
  transactions: readonly TransactionEntity[];
  expenses: readonly ExpenseEntity[];
  invoices: readonly InvoiceEntity[];
  payments: readonly PaymentEntity[];
  receipts: readonly ReceiptEntity[];
}): ClosingChecklist {
  const { period, transactions, expenses, invoices, payments, receipts } = input;
  const inPeriod = (date: ISODate) =>
    isWithinRange(date, period.startDate, period.endDate);

  const draftTransactions = transactions.filter(
    (tx) => inPeriod(tx.date) && tx.status === "draft",
  );
  const unattachedReceipts = transactions.filter(
    (tx) =>
      inPeriod(tx.date) &&
      tx.type === "expense" &&
      tx.status === "confirmed" &&
      tx.receiptIds.length === 0,
  );
  const transactionById = new Map(transactions.map((tx) => [tx.id, tx]));
  const unpaidExpenses = expenses.filter((expense) => {
    if (expense.paidAt !== null || expense.paymentDueDate === null) return false;
    const transaction = transactionById.get(expense.transactionId);
    return transaction !== undefined && transaction.date <= period.endDate;
  });
  const unpaidInvoices = listUnpaidInvoices(invoices, payments, period.endDate)
    .filter((info) => info.invoice.issueDate <= period.endDate)
    .map((info) => info.invoice);
  const unprocessedReceipts = receipts.filter(
    (receipt) => receipt.status === "unprocessed",
  );

  const items: ClosingChecklistItem[] = [
    {
      key: "draft_transactions",
      severity: "blocker",
      count: draftTransactions.length,
      ids: draftTransactions.map((tx) => tx.id),
    },
    {
      key: "unattached_receipts",
      severity: "warning",
      count: unattachedReceipts.length,
      ids: unattachedReceipts.map((tx) => tx.id),
    },
    {
      key: "unpaid_expenses",
      severity: "warning",
      count: unpaidExpenses.length,
      ids: unpaidExpenses.map((expense) => expense.id),
    },
    {
      key: "unpaid_invoices",
      severity: "warning",
      count: unpaidInvoices.length,
      ids: unpaidInvoices.map((invoice) => invoice.id),
    },
    {
      key: "unprocessed_receipts",
      severity: "warning",
      count: unprocessedReceipts.length,
      ids: unprocessedReceipts.map((receipt) => receipt.id),
    },
  ];

  const ready = items.every(
    (item) => item.severity !== "blocker" || item.count === 0,
  );
  return { periodId: period.id, ready, items };
}

export interface DuplicateCandidate {
  transaction: TransactionEntity;
  sameCounterparty: boolean;
}

export function findDuplicateCandidates(
  target: Pick<TransactionEntity, "date" | "amount" | "counterparty">,
  candidates: readonly TransactionEntity[],
): DuplicateCandidate[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.date === target.date && candidate.amount === target.amount,
    )
    .map((transaction) => ({
      transaction,
      sameCounterparty:
        target.counterparty !== "" &&
        transaction.counterparty === target.counterparty,
    }))
    .sort((a, b) => Number(b.sameCounterparty) - Number(a.sameCounterparty));
}
