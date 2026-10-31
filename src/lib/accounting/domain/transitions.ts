import { DomainError } from "./errors";
import type {
  InvoiceStatus,
  ReceiptStatus,
  TransactionEntity,
  TransactionStatus,
} from "./types";

export function assertTransactionMutable(
  transaction: Pick<TransactionEntity, "status">,
): void {
  if (transaction.status === "locked") {
    throw new DomainError(
      "INVALID_STATE",
      "transaction is locked by a closed fiscal period",
    );
  }
}

export function assertTransactionConfirmable(
  transaction: Pick<TransactionEntity, "status">,
): void {
  assertTransactionMutable(transaction);
  if (transaction.status !== "draft") {
    throw new DomainError(
      "INVALID_STATE",
      "only draft transactions can be confirmed",
    );
  }
}

export const TRANSACTION_STATUS_TRANSITIONS: Record<
  TransactionStatus,
  readonly TransactionStatus[]
> = {
  draft: ["confirmed", "locked"],
  confirmed: ["locked"],
  locked: [],
};

export function assertTransactionStatusTransition(
  from: TransactionStatus,
  to: TransactionStatus,
): void {
  if (!TRANSACTION_STATUS_TRANSITIONS[from].includes(to)) {
    throw new DomainError(
      "INVALID_STATE",
      `transaction status cannot change from ${from} to ${to}`,
    );
  }
}

export const RECEIPT_STATUS_TRANSITIONS: Record<
  ReceiptStatus,
  readonly ReceiptStatus[]
> = {
  unprocessed: ["linked", "archived"],
  linked: ["unprocessed", "archived"],
  archived: [],
};

export function assertReceiptStatusTransition(
  from: ReceiptStatus,
  to: ReceiptStatus,
): void {
  if (!RECEIPT_STATUS_TRANSITIONS[from].includes(to)) {
    throw new DomainError(
      "INVALID_STATE",
      `receipt status cannot change from ${from} to ${to}`,
    );
  }
}

export function assertInvoiceIssuable(invoice: {
  status: InvoiceStatus;
}): void {
  if (invoice.status !== "draft") {
    throw new DomainError(
      "INVALID_STATE",
      "only draft invoices can be issued",
    );
  }
}

export function assertInvoicePayable(status: InvoiceStatus): void {
  if (status !== "issued" && status !== "overdue") {
    throw new DomainError(
      "INVALID_STATE",
      `payments can only be recorded against issued or overdue invoices, not ${status}`,
    );
  }
}
