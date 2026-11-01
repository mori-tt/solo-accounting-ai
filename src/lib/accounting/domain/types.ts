import type { ISODate, YearMonth } from "./dates";

export type Role = "owner" | "editor" | "viewer";

export type TransactionType = "income" | "expense" | "transfer";
export type TransactionStatus = "draft" | "confirmed" | "locked";

export type TaxCategory = "taxable" | "nonTaxable" | "exempt" | "outOfScope";

export type TaxMode = "exempt" | "simple" | "standard";

export type ReceiptStatus = "unprocessed" | "linked" | "archived";

export type InvoiceStatus = "draft" | "issued" | "paid" | "overdue";

export type FiscalPeriodStatus = "open" | "closed";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "close"
  | "suggest_ai"
  | "approve_ai"
  | "reject_ai";

export type AiSuggestionStatus = "pending" | "accepted" | "rejected";

export interface AiSuggestion {
  status: AiSuggestionStatus;
  confidence: number;
  account: string | null;
  amount: number | null;
  date: ISODate | null;
  counterparty: string | null;
  rationale: string | null;
  suggestedAt: Date;
}

export interface TransactionEntity {
  id: string;
  type: TransactionType;
  date: ISODate;
  amount: number;
  account: string;
  counterparty: string;
  description: string;
  receiptIds: string[];
  status: TransactionStatus;
  aiSuggestion: AiSuggestion | null;
  idempotencyKey: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseEntity {
  id: string;
  transactionId: string;
  taxCategory: TaxCategory;
  taxAmount: number;
  paymentDueDate: ISODate | null;
  paidAt: ISODate | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReceiptEntity {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  transactionId: string | null;
  status: ReceiptStatus;
  aiSuggestion: AiSuggestion | null;
  idempotencyKey: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface CustomerEntity {
  id: string;
  name: string;
  email: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectEntity {
  id: string;
  customerId: string;
  name: string;
  status: "active" | "done" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceEntity {
  id: string;
  customerId: string;
  projectId: string | null;
  issueDate: ISODate;
  dueDate: ISODate;
  items: InvoiceItem[];
  totalAmount: number;
  status: InvoiceStatus;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentEntity {
  id: string;
  invoiceId: string;
  date: ISODate;
  amount: number;
  transactionId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface AccountBreakdownEntry {
  income: number;
  expense: number;
}

export interface MonthlySummaryEntity {
  id: YearMonth;
  totalIncome: number;
  totalExpense: number;
  accountBreakdown: Record<string, AccountBreakdownEntry>;
  transactionCount: number;
  computedAt: Date;
}

export interface FiscalPeriodEntity {
  id: string;
  startDate: ISODate;
  endDate: ISODate;
  status: FiscalPeriodStatus;
  closedAt: Date | null;
  closedBy: string | null;
  createdAt: Date;
}

export interface AuditLogEntity {
  id: string;
  actorUid: string;
  action: AuditAction;
  targetPath: string;
  createdAt: Date;
}
