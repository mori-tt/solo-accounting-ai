import type {
  AuditLogEntry,
  Business,
  Customer,
  Expense,
  FiscalPeriod,
  FixedAsset,
  FixedAssetStatus,
  Invoice,
  MonthlySummary,
  Payment,
  Project,
  Receipt,
  ReceiptStatus,
  RecurringTemplate,
  Transaction,
} from "../types";
import type {
  AccountingReader,
  AccountingStore,
  CollectionName,
  TransactResult,
} from "./types";
import { docPath } from "./types";

interface IdempotencyRecord {
  value: unknown;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * テスト・開発用のインメモリ実装。
 * transact は単一スレッドで逐次実行されるため、
 * 読み取りと書き込みの不可分性は自明に満たされる。
 */
export class MemoryStore implements AccountingStore {
  private readonly docs = new Map<string, unknown>();
  private readonly idem = new Map<string, IdempotencyRecord>();

  private key(
    businessId: string,
    collection: CollectionName,
    id: string,
  ): string {
    return docPath(businessId, collection, id);
  }

  private get<T>(
    businessId: string,
    collection: CollectionName,
    id: string,
  ): Promise<T | undefined> {
    const doc = this.docs.get(this.key(businessId, collection, id));
    return Promise.resolve(doc === undefined ? undefined : clone(doc as T));
  }

  private list<T extends { id: string }>(
    businessId: string,
    collection: CollectionName,
    filter: (doc: T) => boolean,
  ): Promise<T[]> {
    const prefix = `businesses/${businessId}/${collection}/`;
    const out: T[] = [];
    for (const [path, doc] of this.docs) {
      if (!path.startsWith(prefix)) continue;
      const typed = doc as T;
      if (filter(typed)) out.push(clone(typed));
    }
    return Promise.resolve(out);
  }

  getBusiness(businessId: string): Promise<Business | undefined> {
    return this.get<Business>(businessId, "businesses", businessId);
  }

  getTransaction(
    businessId: string,
    id: string,
  ): Promise<Transaction | undefined> {
    return this.get<Transaction>(businessId, "transactions", id);
  }

  getExpense(businessId: string, id: string): Promise<Expense | undefined> {
    return this.get<Expense>(businessId, "expenses", id);
  }

  getExpenseByTransactionId(
    businessId: string,
    transactionId: string,
  ): Promise<Expense | undefined> {
    const hit = [...this.docs.entries()].find(
      ([path, doc]) =>
        path.startsWith(`businesses/${businessId}/expenses/`) &&
        (doc as Expense).transactionId === transactionId,
    );
    return Promise.resolve(
      hit === undefined ? undefined : clone(hit[1] as Expense),
    );
  }

  getReceipt(businessId: string, id: string): Promise<Receipt | undefined> {
    return this.get<Receipt>(businessId, "receipts", id);
  }

  getCustomer(businessId: string, id: string): Promise<Customer | undefined> {
    return this.get<Customer>(businessId, "customers", id);
  }

  getProject(businessId: string, id: string): Promise<Project | undefined> {
    return this.get<Project>(businessId, "projects", id);
  }

  getInvoice(businessId: string, id: string): Promise<Invoice | undefined> {
    return this.get<Invoice>(businessId, "invoices", id);
  }

  getPayment(businessId: string, id: string): Promise<Payment | undefined> {
    return this.get<Payment>(businessId, "payments", id);
  }

  getMonthlySummary(
    businessId: string,
    monthKey: string,
  ): Promise<MonthlySummary | undefined> {
    return this.get<MonthlySummary>(businessId, "monthlySummaries", monthKey);
  }

  getFiscalPeriod(
    businessId: string,
    id: string,
  ): Promise<FiscalPeriod | undefined> {
    return this.get<FiscalPeriod>(businessId, "fiscalPeriods", id);
  }

  listTransactionsInRange(
    businessId: string,
    startDate: string,
    endDate: string,
  ): Promise<Transaction[]> {
    return this.list<Transaction>(
      businessId,
      "transactions",
      (t) => t.date >= startDate && t.date <= endDate,
    );
  }

  listExpenses(businessId: string): Promise<Expense[]> {
    return this.list<Expense>(businessId, "expenses", () => true);
  }

  listUnpaidExpenses(businessId: string): Promise<Expense[]> {
    return this.list<Expense>(businessId, "expenses", (e) => e.paidAt == null);
  }

  listReceipts(
    businessId: string,
    status?: ReceiptStatus,
  ): Promise<Receipt[]> {
    return this.list<Receipt>(
      businessId,
      "receipts",
      (r) => status === undefined || r.status === status,
    );
  }

  listInvoices(businessId: string): Promise<Invoice[]> {
    return this.list<Invoice>(businessId, "invoices", () => true);
  }

  getRecurringTemplate(
    businessId: string,
    id: string,
  ): Promise<RecurringTemplate | undefined> {
    return this.get<RecurringTemplate>(businessId, "recurringTemplates", id);
  }

  listRecurringTemplates(
    businessId: string,
  ): Promise<RecurringTemplate[]> {
    return this.list<RecurringTemplate>(
      businessId,
      "recurringTemplates",
      () => true,
    );
  }

  getFixedAsset(
    businessId: string,
    id: string,
  ): Promise<FixedAsset | undefined> {
    return this.get<FixedAsset>(businessId, "fixedAssets", id);
  }

  async listFixedAssets(
    businessId: string,
    status?: FixedAssetStatus,
  ): Promise<FixedAsset[]> {
    const all = await this.list<FixedAsset>(
      businessId,
      "fixedAssets",
      (a) => status === undefined || a.status === status,
    );
    if (status !== undefined) {
      all.sort(
        (a, b) =>
          a.acquiredDate.localeCompare(b.acquiredDate) ||
          a.id.localeCompare(b.id),
      );
    }
    return all;
  }

  listPaymentsForInvoice(
    businessId: string,
    invoiceId: string,
  ): Promise<Payment[]> {
    return this.list<Payment>(
      businessId,
      "payments",
      (p) => p.invoiceId === invoiceId,
    );
  }

  listFiscalPeriods(businessId: string): Promise<FiscalPeriod[]> {
    return this.list<FiscalPeriod>(businessId, "fiscalPeriods", () => true);
  }

  listAuditLogs(businessId: string): Promise<AuditLogEntry[]> {
    return this.list<AuditLogEntry>(businessId, "auditLogs", () => true);
  }

  transact<T>(
    businessId: string,
    options: { idempotencyKey?: string },
    work: (tx: AccountingReader) => Promise<TransactResult<T>>,
  ): Promise<{ value: T; replayed: boolean }> {
    return this.doTransact(businessId, options, work);
  }

  private async doTransact<T>(
    businessId: string,
    options: { idempotencyKey?: string },
    work: (tx: AccountingReader) => Promise<TransactResult<T>>,
  ): Promise<{ value: T; replayed: boolean }> {
    const idemKey = options.idempotencyKey
      ? `${businessId}${options.idempotencyKey}`
      : undefined;
    if (idemKey !== undefined) {
      const record = this.idem.get(idemKey);
      if (record !== undefined) {
        return { value: clone(record.value) as T, replayed: true };
      }
    }

    const { batch, value } = await work(this);
    for (const put of batch.puts) {
      this.docs.set(this.key(businessId, put.collection, put.id), clone(put.data));
    }
    for (const audit of batch.audits) {
      this.docs.set(
        this.key(businessId, "auditLogs", audit.id),
        clone(audit),
      );
    }
    if (idemKey !== undefined) {
      this.idem.set(idemKey, { value: clone(value) });
    }
    return { value, replayed: false };
  }
}
