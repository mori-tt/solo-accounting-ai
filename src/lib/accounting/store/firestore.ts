import { createHash } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction as FsTransaction,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
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
import type {
  AccountingReader,
  AccountingStore,
  CollectionName,
  TransactResult,
} from "./types";

type DocGetter = (ref: DocumentReference) => Promise<DocumentSnapshot>;
type QueryGetter = (query: Query) => Promise<QuerySnapshot>;

const DATE_FIELD_SUFFIX = "At";

/**
 * `*At` で終わるフィールド(ISO 8601文字列)を Firestore Timestamp に変換する。
 * YYYY-MM-DD 文字列(date, dueDate 等)はそのまま保存する。
 * undefined は Firestore に書けないため除去する。
 */
function toStore(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStore(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[key] =
        key.endsWith(DATE_FIELD_SUFFIX) && typeof v === "string"
          ? Timestamp.fromDate(new Date(v))
          : toStore(v);
    }
    return out;
  }
  return value;
}

/** Timestamp を ISO 8601 文字列へ戻す。 */
function fromStore(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => fromStore(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = fromStore(v);
    }
    return out;
  }
  return value;
}

function idempotencyDocId(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

class FirestoreAccountingReader implements AccountingReader {
  constructor(
    private readonly db: Firestore,
    private readonly getDoc: DocGetter,
    private readonly getQuery: QueryGetter,
  ) {}

  private doc(
    businessId: string,
    collection: CollectionName,
    id: string,
  ): DocumentReference {
    if (collection === "businesses") {
      return this.db.collection("businesses").doc(id);
    }
    return this.db
      .collection("businesses")
      .doc(businessId)
      .collection(collection)
      .doc(id);
  }

  private col(
    businessId: string,
    collection: CollectionName,
  ) {
    return this.db
      .collection("businesses")
      .doc(businessId)
      .collection(collection);
  }

  private async readDoc<T>(
    businessId: string,
    collection: CollectionName,
    id: string,
  ): Promise<T | undefined> {
    const snap = await this.getDoc(this.doc(businessId, collection, id));
    if (!snap.exists) return undefined;
    return fromStore(snap.data()) as T;
  }

  private async readQuery<T>(query: Query): Promise<T[]> {
    const snap = await this.getQuery(query);
    return snap.docs.map((d) => fromStore(d.data()) as T);
  }

  getBusiness(businessId: string): Promise<Business | undefined> {
    return this.readDoc(businessId, "businesses", businessId);
  }

  getTransaction(
    businessId: string,
    id: string,
  ): Promise<Transaction | undefined> {
    return this.readDoc(businessId, "transactions", id);
  }

  getExpense(businessId: string, id: string): Promise<Expense | undefined> {
    return this.readDoc(businessId, "expenses", id);
  }

  async getExpenseByTransactionId(
    businessId: string,
    transactionId: string,
  ): Promise<Expense | undefined> {
    const hits = await this.readQuery<Expense>(
      this.col(businessId, "expenses").where("transactionId", "==", transactionId),
    );
    return hits[0];
  }

  getReceipt(businessId: string, id: string): Promise<Receipt | undefined> {
    return this.readDoc(businessId, "receipts", id);
  }

  getCustomer(businessId: string, id: string): Promise<Customer | undefined> {
    return this.readDoc(businessId, "customers", id);
  }

  getProject(businessId: string, id: string): Promise<Project | undefined> {
    return this.readDoc(businessId, "projects", id);
  }

  getInvoice(businessId: string, id: string): Promise<Invoice | undefined> {
    return this.readDoc(businessId, "invoices", id);
  }

  getPayment(businessId: string, id: string): Promise<Payment | undefined> {
    return this.readDoc(businessId, "payments", id);
  }

  getMonthlySummary(
    businessId: string,
    monthKey: string,
  ): Promise<MonthlySummary | undefined> {
    return this.readDoc(businessId, "monthlySummaries", monthKey);
  }

  getFiscalPeriod(
    businessId: string,
    id: string,
  ): Promise<FiscalPeriod | undefined> {
    return this.readDoc(businessId, "fiscalPeriods", id);
  }

  listTransactionsInRange(
    businessId: string,
    startDate: string,
    endDate: string,
  ): Promise<Transaction[]> {
    return this.readQuery<Transaction>(
      this.col(businessId, "transactions")
        .where("date", ">=", startDate)
        .where("date", "<=", endDate),
    );
  }

  listExpenses(businessId: string): Promise<Expense[]> {
    return this.readQuery<Expense>(this.col(businessId, "expenses"));
  }

  async listUnpaidExpenses(businessId: string): Promise<Expense[]> {
    // paidAt フィールド未設定のドキュメントは `== null` クエリで
    // ヒットしない可能性があるため、取得後にフィルタする。
    const all = await this.listExpenses(businessId);
    return all.filter((e) => e.paidAt == null);
  }

  listReceipts(
    businessId: string,
    status?: ReceiptStatus,
  ): Promise<Receipt[]> {
    const base = this.col(businessId, "receipts");
    return this.readQuery<Receipt>(
      status === undefined ? base : base.where("status", "==", status),
    );
  }

  listInvoices(businessId: string): Promise<Invoice[]> {
    return this.readQuery<Invoice>(this.col(businessId, "invoices"));
  }

  listPaymentsForInvoice(
    businessId: string,
    invoiceId: string,
  ): Promise<Payment[]> {
    return this.readQuery<Payment>(
      this.col(businessId, "payments").where("invoiceId", "==", invoiceId),
    );
  }

  listFiscalPeriods(businessId: string): Promise<FiscalPeriod[]> {
    return this.readQuery<FiscalPeriod>(
      this.col(businessId, "fiscalPeriods"),
    );
  }

  listAuditLogs(businessId: string): Promise<AuditLogEntry[]> {
    return this.readQuery<AuditLogEntry>(this.col(businessId, "auditLogs"));
  }
}

/**
 * Admin SDK 経由の Firestore 実装。サーバーサイド専用。
 * Security Rules をバイパスするため、呼び出し側で認可を行うこと。
 */
export class FirestoreAccountingStore implements AccountingStore {
  private readonly reader: AccountingReader;

  constructor(private readonly db: Firestore = getAdminDb()) {
    this.reader = new FirestoreAccountingReader(
      db,
      (ref) => ref.get(),
      (query) => query.get(),
    );
  }

  private txReader(tx: FsTransaction): AccountingReader {
    return new FirestoreAccountingReader(
      this.db,
      (ref) => tx.get(ref),
      (query) => tx.get(query),
    );
  }

  getBusiness(businessId: string) {
    return this.reader.getBusiness(businessId);
  }
  getTransaction(businessId: string, id: string) {
    return this.reader.getTransaction(businessId, id);
  }
  getExpense(businessId: string, id: string) {
    return this.reader.getExpense(businessId, id);
  }
  getExpenseByTransactionId(businessId: string, transactionId: string) {
    return this.reader.getExpenseByTransactionId(businessId, transactionId);
  }
  getReceipt(businessId: string, id: string) {
    return this.reader.getReceipt(businessId, id);
  }
  getCustomer(businessId: string, id: string) {
    return this.reader.getCustomer(businessId, id);
  }
  getProject(businessId: string, id: string) {
    return this.reader.getProject(businessId, id);
  }
  getInvoice(businessId: string, id: string) {
    return this.reader.getInvoice(businessId, id);
  }
  getPayment(businessId: string, id: string) {
    return this.reader.getPayment(businessId, id);
  }
  getMonthlySummary(businessId: string, monthKey: string) {
    return this.reader.getMonthlySummary(businessId, monthKey);
  }
  getFiscalPeriod(businessId: string, id: string) {
    return this.reader.getFiscalPeriod(businessId, id);
  }
  listTransactionsInRange(businessId: string, startDate: string, endDate: string) {
    return this.reader.listTransactionsInRange(businessId, startDate, endDate);
  }
  listExpenses(businessId: string) {
    return this.reader.listExpenses(businessId);
  }
  listUnpaidExpenses(businessId: string) {
    return this.reader.listUnpaidExpenses(businessId);
  }
  listReceipts(businessId: string, status?: ReceiptStatus) {
    return this.reader.listReceipts(businessId, status);
  }
  listInvoices(businessId: string) {
    return this.reader.listInvoices(businessId);
  }
  listPaymentsForInvoice(businessId: string, invoiceId: string) {
    return this.reader.listPaymentsForInvoice(businessId, invoiceId);
  }
  listFiscalPeriods(businessId: string) {
    return this.reader.listFiscalPeriods(businessId);
  }
  listAuditLogs(businessId: string) {
    return this.reader.listAuditLogs(businessId);
  }

  async transact<T>(
    businessId: string,
    options: { idempotencyKey?: string },
    work: (tx: AccountingReader) => Promise<TransactResult<T>>,
  ): Promise<{ value: T; replayed: boolean }> {
    const idemRef = options.idempotencyKey
      ? this.db
          .collection("businesses")
          .doc(businessId)
          .collection("idempotencyKeys")
          .doc(idempotencyDocId(options.idempotencyKey))
      : undefined;

    return this.db.runTransaction(async (tx) => {
      if (idemRef !== undefined) {
        const record = await tx.get(idemRef);
        if (record.exists) {
          return {
            value: record.data()!.value as T,
            replayed: true,
          };
        }
      }

      const { batch, value } = await work(this.txReader(tx));

      for (const put of batch.puts) {
        const ref =
          put.collection === "businesses"
            ? this.db.collection("businesses").doc(put.id)
            : this.db
                .collection("businesses")
                .doc(businessId)
                .collection(put.collection)
                .doc(put.id);
        tx.set(ref, toStore(put.data));
      }
      for (const audit of batch.audits) {
        const ref = this.db
          .collection("businesses")
          .doc(businessId)
          .collection("auditLogs")
          .doc(audit.id);
        tx.set(ref, toStore(audit));
      }
      if (idemRef !== undefined) {
        tx.set(idemRef, {
          key: options.idempotencyKey,
          // undefined を除去して Firestore に書ける形にする
          value: JSON.parse(JSON.stringify(value)),
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      return { value, replayed: false };
    });
  }
}
