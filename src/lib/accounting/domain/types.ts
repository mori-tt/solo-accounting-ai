import type {
  AuditLogEntry,
  Customer,
  Expense,
  FiscalPeriod,
  Invoice,
  MemberRole,
  MonthlySummary,
  Payment,
  Project,
  Receipt,
  Transaction,
} from "../types";
import type { ISODate, YearMonth } from "./dates";

/**
 * enum・プリミティブ型はルート側(../types.ts)の定義に統一し、ここでは再 export する。
 * TaxCategory は永続化形式の snake_case(non_taxable/out_of_scope)が正。
 */
export type {
  AuditAction,
  FiscalPeriodStatus,
  InvoiceItem,
  InvoiceStatus,
  ReceiptStatus,
  TaxCategory,
  TaxMode,
  TransactionStatus,
  TransactionType,
} from "../types";

export type Role = MemberRole;

/**
 * 旧世代 service.ts/store.ts 系のエンティティ型。
 * ルート側のドキュメント型とフィールドを共有するが、タイムスタンプは
 * ISO文字列ではなく Date、未設定値は optional ではなく null で保持する
 * (旧世代の永続化モデルに合わせた差分のみ追加定義する)。
 */
export type TransactionEntity = Omit<
  Transaction,
  "createdAt" | "updatedAt" | "taxCategory" | "taxRate"
> & {
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExpenseEntity = Omit<Expense, "paymentDueDate" | "paidAt"> & {
  paymentDueDate: ISODate | null;
  paidAt: ISODate | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReceiptEntity = Omit<
  Receipt,
  "transactionId" | "createdAt" | "updatedAt"
> & {
  transactionId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
};

export type CustomerEntity = Omit<
  Customer,
  "email" | "address" | "createdAt"
> & {
  email: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectEntity = Omit<Project, "createdAt"> & {
  createdAt: Date;
  updatedAt: Date;
};

export type InvoiceEntity = Omit<
  Invoice,
  "projectId" | "taxAmount" | "createdAt" | "updatedAt"
> & {
  projectId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PaymentEntity = Omit<Payment, "transactionId" | "createdAt"> & {
  transactionId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
};

export interface AccountBreakdownEntry {
  income: number;
  expense: number;
}

export type MonthlySummaryEntity = Omit<
  MonthlySummary,
  "month" | "computedAt"
> & {
  id: YearMonth;
  transactionCount: number;
  computedAt: Date;
};

export type FiscalPeriodEntity = Omit<
  FiscalPeriod,
  "fiscalYear" | "closedAt" | "closedBy"
> & {
  closedAt: Date | null;
  closedBy: string | null;
  createdAt: Date;
};

export type AuditLogEntity = Omit<AuditLogEntry, "createdAt"> & {
  createdAt: Date;
};
