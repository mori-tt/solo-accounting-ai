import type {
  AuditLogEntry,
  Business,
  Customer,
  Expense,
  FiscalPeriod,
  Invoice,
  MonthlySummary,
  Payment,
  Project,
  Receipt,
  ReceiptStatus,
  Transaction,
} from "../types";

/**
 * businesses/{businessId} 配下のサブコレクション名。
 * "businesses" のみ事業ルートドキュメント自体を指す特例。
 * "idempotencyKeys" は二重登録防止用の内部コレクション。
 */
export type CollectionName =
  | "businesses"
  | "transactions"
  | "expenses"
  | "receipts"
  | "customers"
  | "projects"
  | "invoices"
  | "payments"
  | "monthlySummaries"
  | "fiscalPeriods"
  | "auditLogs"
  | "idempotencyKeys";

export interface AccountingReader {
  getBusiness(businessId: string): Promise<Business | undefined>;
  getTransaction(
    businessId: string,
    id: string,
  ): Promise<Transaction | undefined>;
  getExpense(businessId: string, id: string): Promise<Expense | undefined>;
  getExpenseByTransactionId(
    businessId: string,
    transactionId: string,
  ): Promise<Expense | undefined>;
  getReceipt(businessId: string, id: string): Promise<Receipt | undefined>;
  getCustomer(businessId: string, id: string): Promise<Customer | undefined>;
  getProject(businessId: string, id: string): Promise<Project | undefined>;
  getInvoice(businessId: string, id: string): Promise<Invoice | undefined>;
  getPayment(businessId: string, id: string): Promise<Payment | undefined>;
  getMonthlySummary(
    businessId: string,
    monthKey: string,
  ): Promise<MonthlySummary | undefined>;
  getFiscalPeriod(
    businessId: string,
    id: string,
  ): Promise<FiscalPeriod | undefined>;
  /** 両端含む日付範囲のTransaction一覧 */
  listTransactionsInRange(
    businessId: string,
    startDate: string,
    endDate: string,
  ): Promise<Transaction[]>;
  listExpenses(businessId: string): Promise<Expense[]>;
  /** paidAt 未設定の経費(未払)一覧 */
  listUnpaidExpenses(businessId: string): Promise<Expense[]>;
  listReceipts(
    businessId: string,
    status?: ReceiptStatus,
  ): Promise<Receipt[]>;
  listInvoices(businessId: string): Promise<Invoice[]>;
  listPaymentsForInvoice(
    businessId: string,
    invoiceId: string,
  ): Promise<Payment[]>;
  listFiscalPeriods(businessId: string): Promise<FiscalPeriod[]>;
  listAuditLogs(businessId: string): Promise<AuditLogEntry[]>;
}

export interface PutOp {
  collection: CollectionName;
  id: string;
  data: unknown;
}

/**
 * 1コマンド分の原子書き込み。
 * puts と audits は同一トランザクションで適用される。
 */
export interface CommitBatch {
  puts: PutOp[];
  audits: AuditLogEntry[];
}

export interface TransactResult<T> {
  batch: CommitBatch;
  /**
   * コマンドの返り値。idempotencyKey 指定時はレコードに保存され、
   * リプレイ時に同じ値が返る。
   */
  value: T;
}

export interface AccountingStore extends AccountingReader {
  /**
   * work(tx) 内の読み取りと batch の書き込みを不可分に実行する。
   * idempotencyKey が既に記録されている場合は work を実行せず、
   * 保存済みの value を replayed=true で返す(二重登録防止)。
   */
  transact<T>(
    businessId: string,
    options: { idempotencyKey?: string },
    work: (tx: AccountingReader) => Promise<TransactResult<T>>,
  ): Promise<{ value: T; replayed: boolean }>;
}

export function businessDocPath(businessId: string): string {
  return `businesses/${businessId}`;
}

export function docPath(
  businessId: string,
  collection: CollectionName,
  id: string,
): string {
  if (collection === "businesses") return `businesses/${id}`;
  return `businesses/${businessId}/${collection}/${id}`;
}
