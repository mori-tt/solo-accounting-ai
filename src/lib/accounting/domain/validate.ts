import { assertISODate, type ISODate } from "./dates";
import { DomainError } from "./errors";
import {
  assertNonNegativeYen,
  assertPositiveYen,
  isIntegerYen,
} from "./money";
import type {
  InvoiceItem,
  TaxCategory,
  TransactionType,
} from "./types";

export interface TransactionInput {
  type: TransactionType;
  date: ISODate;
  amount: number;
  account: string;
  counterparty: string;
  description: string;
}

export interface ExpenseInput extends TransactionInput {
  taxCategory: TaxCategory;
  taxAmount: number;
  paymentDueDate?: ISODate;
}

export interface InvoiceInput {
  customerId: string;
  projectId?: string;
  issueDate: ISODate;
  dueDate: ISODate;
  items: InvoiceItem[];
}

export interface PaymentInput {
  invoiceId: string;
  date: ISODate;
  amount: number;
  transactionId?: string;
}

export interface ReceiptInput {
  storagePath: string;
  fileName: string;
  mimeType: string;
}

export const TRANSACTION_TYPES: readonly TransactionType[] = [
  "income",
  "expense",
  "transfer",
];

export const TAX_CATEGORIES: readonly TaxCategory[] = [
  "taxable",
  "nonTaxable",
  "exempt",
  "outOfScope",
];

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainError(
      "VALIDATION_FAILED",
      `${field} must be a non-empty string`,
    );
  }
}

export function validateTransactionInput(input: TransactionInput): void {
  if (!TRANSACTION_TYPES.includes(input.type)) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `type must be one of ${TRANSACTION_TYPES.join("/")}`,
    );
  }
  assertISODate(input.date, "date");
  assertPositiveYen(input.amount, "amount");
  assertNonEmptyString(input.account, "account");
  if (typeof input.counterparty !== "string") {
    throw new DomainError("VALIDATION_FAILED", "counterparty must be a string");
  }
  if (typeof input.description !== "string") {
    throw new DomainError("VALIDATION_FAILED", "description must be a string");
  }
}

export function validateExpenseInput(input: ExpenseInput): void {
  validateTransactionInput({ ...input, type: "expense" });
  if (input.type !== "expense") {
    throw new DomainError("VALIDATION_FAILED", "expense type must be expense");
  }
  if (!TAX_CATEGORIES.includes(input.taxCategory)) {
    throw new DomainError(
      "VALIDATION_FAILED",
      `taxCategory must be one of ${TAX_CATEGORIES.join("/")}`,
    );
  }
  assertNonNegativeYen(input.taxAmount, "taxAmount");
  if (input.taxAmount > input.amount) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "taxAmount must not exceed the expense amount",
    );
  }
  if (input.paymentDueDate !== undefined) {
    assertISODate(input.paymentDueDate, "paymentDueDate");
  }
}

export function validateInvoiceInput(input: InvoiceInput): number {
  assertNonEmptyString(input.customerId, "customerId");
  assertISODate(input.issueDate, "issueDate");
  assertISODate(input.dueDate, "dueDate");
  if (input.dueDate < input.issueDate) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "dueDate must not be before issueDate",
    );
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "items must contain at least one line item",
    );
  }
  let total = 0;
  for (const [index, item] of input.items.entries()) {
    const field = `items[${index}]`;
    assertNonEmptyString(item.description, `${field}.description`);
    if (
      typeof item.quantity !== "number" ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `${field}.quantity must be a positive number`,
      );
    }
    assertNonNegativeYen(item.unitPrice, `${field}.unitPrice`);
    if (!isIntegerYen(item.amount)) {
      throw new DomainError(
        "INVALID_AMOUNT",
        `${field}.amount must be an integer yen amount`,
      );
    }
    if (Math.abs(item.quantity * item.unitPrice - item.amount) > 1e-9) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `${field}.amount must equal quantity * unitPrice`,
      );
    }
    total += item.amount;
    if (!Number.isSafeInteger(total)) {
      throw new DomainError("INVALID_AMOUNT", "invoice total overflow");
    }
  }
  if (total <= 0) {
    throw new DomainError(
      "INVALID_AMOUNT",
      "invoice totalAmount must be a positive yen amount",
    );
  }
  return total;
}

export function validatePaymentInput(input: PaymentInput): void {
  assertNonEmptyString(input.invoiceId, "invoiceId");
  assertISODate(input.date, "date");
  assertPositiveYen(input.amount, "amount");
  if (input.transactionId !== undefined) {
    assertNonEmptyString(input.transactionId, "transactionId");
  }
}

export function validateReceiptInput(input: ReceiptInput): void {
  assertNonEmptyString(input.storagePath, "storagePath");
  assertNonEmptyString(input.fileName, "fileName");
  assertNonEmptyString(input.mimeType, "mimeType");
}

export function assertConfidence(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "confidence must be a number between 0 and 1",
    );
  }
}
