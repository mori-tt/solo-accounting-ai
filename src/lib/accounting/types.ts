import type { DateString } from "./dates";
import type { ConsumptionTaxRate } from "./domain/tax";

/**
 * docs/FIRESTORE_SCHEMA.md に対応するドメイン型。
 * 日時フィールドはドメイン内では ISO 8601 文字列として扱い、
 * Firestore への変換は store 層が担う。
 */

export type TaxMode = "exempt" | "simple" | "standard";

export type MemberRole = "owner" | "editor" | "viewer";

export type TransactionType = "income" | "expense" | "transfer";

export type TransactionStatus = "draft" | "confirmed" | "locked";

export type TaxCategory = "taxable" | "non_taxable" | "exempt" | "out_of_scope";

export type ReceiptStatus = "unprocessed" | "linked" | "archived";

export type ProjectStatus = "active" | "done" | "archived";

export type InvoiceStatus = "draft" | "issued" | "paid" | "overdue";

export type FiscalPeriodStatus = "open" | "closed";

export type AuditAction = "create" | "update" | "delete" | "close";

export interface Business {
  id: string;
  name: string;
  ownerUid: string;
  fiscalYearStartMonth: number;
  taxMode: TaxMode;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  date: DateString;
  /** 円・整数・正数 */
  amount: number;
  /** 勘定科目コード */
  account: string;
  counterparty: string;
  description: string;
  receiptIds: string[];
  status: TransactionStatus;
  /** 消費税区分。未設定は区分未分類(税フィールド導入前データの後方互換) */
  taxCategory?: TaxCategory;
  /** 税率区分。taxCategory=taxable のときのみ有効(省略時 standard) */
  taxRate?: ConsumptionTaxRate;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  transactionId: string;
  taxCategory: TaxCategory;
  /** 消費税額(円・整数・0以上) */
  taxAmount: number;
  paymentDueDate?: DateString;
  paidAt?: DateString;
}

export interface Receipt {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  transactionId?: string;
  status: ReceiptStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  address?: string;
  createdAt: string;
}

export interface Project {
  id: string;
  customerId: string;
  name: string;
  status: ProjectStatus;
  createdAt: string;
}

export interface InvoiceItem {
  description: string;
  /** 正の整数 */
  quantity: number;
  /** 円・整数・0以上(税込) */
  unitPrice: number;
  /** 円・整数 = quantity * unitPrice(税込) */
  amount: number;
  /** 税率区分。省略時は標準税率(税フィールド導入前データの後方互換) */
  taxRate?: ConsumptionTaxRate;
  /** 明細に含まれる消費税額(円・整数)。登録時にサーバーで算出 */
  taxAmount?: number;
}

export interface Invoice {
  id: string;
  customerId: string;
  projectId?: string;
  issueDate: DateString;
  dueDate: DateString;
  items: InvoiceItem[];
  /** 円・整数 = items の amount 合計(税込) */
  totalAmount: number;
  /** 消費税合計(円・整数)。税フィールド導入前データは未設定 */
  taxAmount?: number;
  status: InvoiceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  date: DateString;
  /** 円・整数・正数 */
  amount: number;
  transactionId?: string;
  createdAt: string;
}

export interface MonthlySummary {
  /** `yyyyMM` 形式のドキュメントID */
  month: string;
  totalIncome: number;
  totalExpense: number;
  /** 科目コードごとの収支 */
  accountBreakdown: Record<string, { income: number; expense: number }>;
  computedAt: string;
}

export interface FiscalPeriod {
  id: string;
  fiscalYear: number;
  startDate: DateString;
  endDate: DateString;
  status: FiscalPeriodStatus;
  closedAt?: string;
  closedBy?: string;
}

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  action: AuditAction;
  /** 対象ドキュメントのパス。内容スナップショットは保存しない */
  targetPath: string;
  createdAt: string;
}
