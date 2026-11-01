import { buildAuditLog, businessDocPath } from "./domain/audit";
import {
  buildClosingChecklist,
  findDuplicateCandidates,
  listUnpaidExpenses,
  listUnpaidInvoices,
  type ClosingChecklist,
  type DuplicateCandidate,
  type UnpaidExpenseInfo,
  type UnpaidInvoiceInfo,
} from "./domain/checks";
import {
  assertISODate,
  assertYearMonth,
  todayISO,
  type ISODate,
  type YearMonth,
} from "./domain/dates";
import { DomainError } from "./domain/errors";
import { findClosedPeriod, fiscalPeriodRange } from "./domain/fiscal";
import { computeMonthlySummary } from "./domain/summary";
import {
  assertInvoiceIssuable,
  assertInvoicePayable,
  assertReceiptStatusTransition,
  assertTransactionConfirmable,
  assertTransactionMutable,
} from "./domain/transitions";
import type {
  AuditAction,
  AuditLogEntity,
  CustomerEntity,
  ExpenseEntity,
  FiscalPeriodEntity,
  InvoiceEntity,
  MonthlySummaryEntity,
  PaymentEntity,
  ProjectEntity,
  ReceiptEntity,
  TransactionEntity,
} from "./domain/types";
import {
  validateExpenseInput,
  validateInvoiceInput,
  validatePaymentInput,
  validateReceiptInput,
  validateTransactionInput,
  type ExpenseInput,
  type InvoiceInput,
  type PaymentInput,
  type ReceiptInput,
  type TransactionInput,
} from "./domain/validate";
import type {
  AccountingStore,
  CollectionName,
  EntityByCollection,
} from "./store";

export type TransactionPatch = Partial<TransactionInput>;

export interface Idempotent {
  idempotencyKey?: string;
}

export interface RegisterTransactionResult {
  transaction: TransactionEntity;
  deduplicated: boolean;
}

export interface RegisterExpenseResult {
  transaction: TransactionEntity;
  expense: ExpenseEntity;
  deduplicated: boolean;
}

export interface RegisterInvoiceResult {
  invoice: InvoiceEntity;
  deduplicated: boolean;
}

export interface RecordPaymentResult {
  payment: PaymentEntity;
  invoice: InvoiceEntity;
  deduplicated: boolean;
}

export interface RegisterReceiptResult {
  receipt: ReceiptEntity;
  deduplicated: boolean;
}

export interface CloseFiscalPeriodResult {
  period: FiscalPeriodEntity;
  lockedTransactionIds: string[];
}

export interface AccountingServiceDeps {
  clock?: () => Date;
  newId?: () => string;
}

export class AccountingService {
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly store: AccountingStore,
    deps: AccountingServiceDeps = {},
  ) {
    this.clock = deps.clock ?? (() => new Date());
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  private now(): Date {
    return this.clock();
  }

  private today(): ISODate {
    return todayISO(this.now());
  }

  private async requireDoc<C extends CollectionName>(
    store: AccountingStore,
    businessId: string,
    collection: C,
    id: string,
  ): Promise<EntityByCollection[C]> {
    const doc = await store.get(businessId, collection, id);
    if (!doc) {
      throw new DomainError("NOT_FOUND", `${collection}/${id} not found`);
    }
    return doc;
  }

  private async assertPeriodOpen(
    store: AccountingStore,
    businessId: string,
    date: ISODate,
  ): Promise<void> {
    const periods = await store.list(businessId, "fiscalPeriods");
    const closed = findClosedPeriod(periods, date);
    if (closed) {
      throw new DomainError(
        "PERIOD_CLOSED",
        `${date} belongs to closed fiscal period ${closed.id}`,
      );
    }
  }

  private async writeAudit(
    store: AccountingStore,
    businessId: string,
    actorUid: string,
    action: AuditAction,
    collection: CollectionName,
    docId: string,
  ): Promise<void> {
    const id = this.newId();
    await store.create(
      businessId,
      "auditLogs",
      id,
      buildAuditLog({
        id,
        actorUid,
        action,
        targetPath: businessDocPath(businessId, collection, docId),
        createdAt: this.now(),
      }),
    );
  }

  private async findIdempotent<
    C extends "transactions" | "invoices" | "payments" | "receipts",
  >(
    store: AccountingStore,
    businessId: string,
    collection: C,
    key: string | undefined,
  ): Promise<EntityByCollection[C] | null> {
    if (!key) return null;
    const existingId = await store.findByIdempotencyKey(
      businessId,
      collection,
      key,
    );
    if (!existingId) return null;
    return store.get(businessId, collection, existingId);
  }

  async registerTransaction(
    businessId: string,
    input: TransactionInput & Idempotent,
    actorUid: string,
  ): Promise<RegisterTransactionResult> {
    validateTransactionInput(input);
    return this.store.runInTransaction(async (store) => {
      const existing = await this.findIdempotent(
        store,
        businessId,
        "transactions",
        input.idempotencyKey,
      );
      if (existing) return { transaction: existing, deduplicated: true };

      await this.assertPeriodOpen(store, businessId, input.date);
      const now = this.now();
      const id = this.newId();
      const transaction: TransactionEntity = {
        id,
        type: input.type,
        date: input.date,
        amount: input.amount,
        account: input.account,
        counterparty: input.counterparty,
        description: input.description,
        receiptIds: [],
        status: "draft",
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: actorUid,
        createdAt: now,
        updatedAt: now,
      };
      await store.create(businessId, "transactions", id, transaction);
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "create",
        "transactions",
        id,
      );
      return { transaction, deduplicated: false };
    });
  }

  async updateTransaction(
    businessId: string,
    transactionId: string,
    patch: TransactionPatch,
    actorUid: string,
  ): Promise<TransactionEntity> {
    return this.store.runInTransaction(async (store) => {
      const existing = await this.requireDoc(
        store,
        businessId,
        "transactions",
        transactionId,
      );
      assertTransactionMutable(existing);
      await this.assertPeriodOpen(store, businessId, existing.date);
      if (patch.type !== undefined && patch.type !== existing.type) {
        const linkedExpense = (await store.list(businessId, "expenses")).find(
          (expense) => expense.transactionId === transactionId,
        );
        if (linkedExpense) {
          throw new DomainError(
            "INVALID_STATE",
            "cannot change the type of a transaction that has an expense record",
          );
        }
      }

      const merged: TransactionInput = {
        type: patch.type ?? existing.type,
        date: patch.date ?? existing.date,
        amount: patch.amount ?? existing.amount,
        account: patch.account ?? existing.account,
        counterparty: patch.counterparty ?? existing.counterparty,
        description: patch.description ?? existing.description,
      };
      validateTransactionInput(merged);
      await this.assertPeriodOpen(store, businessId, merged.date);

      await store.update(businessId, "transactions", transactionId, {
        ...merged,
        updatedAt: this.now(),
      });
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "update",
        "transactions",
        transactionId,
      );
      return this.requireDoc(store, businessId, "transactions", transactionId);
    });
  }

  async deleteTransaction(
    businessId: string,
    transactionId: string,
    actorUid: string,
  ): Promise<void> {
    return this.store.runInTransaction(async (store) => {
      const existing = await this.requireDoc(
        store,
        businessId,
        "transactions",
        transactionId,
      );
      assertTransactionMutable(existing);
      await this.assertPeriodOpen(store, businessId, existing.date);
      const linkedExpense = (await store.list(businessId, "expenses")).find(
        (expense) => expense.transactionId === transactionId,
      );
      if (linkedExpense) {
        await store.remove(businessId, "expenses", linkedExpense.id);
        await this.writeAudit(
          store,
          businessId,
          actorUid,
          "delete",
          "expenses",
          linkedExpense.id,
        );
      }
      await store.remove(businessId, "transactions", transactionId);
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "delete",
        "transactions",
        transactionId,
      );
    });
  }

  async confirmTransaction(
    businessId: string,
    transactionId: string,
    actorUid: string,
  ): Promise<TransactionEntity> {
    return this.store.runInTransaction(async (store) => {
      const existing = await this.requireDoc(
        store,
        businessId,
        "transactions",
        transactionId,
      );
      assertTransactionConfirmable(existing);
      await this.assertPeriodOpen(store, businessId, existing.date);
      await store.update(businessId, "transactions", transactionId, {
        status: "confirmed",
        updatedAt: this.now(),
      });
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "update",
        "transactions",
        transactionId,
      );
      return this.requireDoc(store, businessId, "transactions", transactionId);
    });
  }

  async registerExpense(
    businessId: string,
    input: ExpenseInput & Idempotent,
    actorUid: string,
  ): Promise<RegisterExpenseResult> {
    validateExpenseInput(input);
    return this.store.runInTransaction(async (store) => {
      const existing = await this.findIdempotent(
        store,
        businessId,
        "transactions",
        input.idempotencyKey,
      );
      if (existing) {
        const expense = await store.get(
          businessId,
          "expenses",
          existing.id,
        );
        if (!expense) {
          throw new DomainError(
            "NOT_FOUND",
            `expense for transaction ${existing.id} not found`,
          );
        }
        return { transaction: existing, expense, deduplicated: true };
      }

      await this.assertPeriodOpen(store, businessId, input.date);
      const now = this.now();
      const id = this.newId();
      const transaction: TransactionEntity = {
        id,
        type: "expense",
        date: input.date,
        amount: input.amount,
        account: input.account,
        counterparty: input.counterparty,
        description: input.description,
        receiptIds: [],
        status: "draft",
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: actorUid,
        createdAt: now,
        updatedAt: now,
      };
      const expense: ExpenseEntity = {
        id,
        transactionId: id,
        taxCategory: input.taxCategory,
        taxAmount: input.taxAmount,
        paymentDueDate: input.paymentDueDate ?? null,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await store.create(businessId, "transactions", id, transaction);
      await store.create(businessId, "expenses", id, expense);
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "create",
        "transactions",
        id,
      );
      return { transaction, expense, deduplicated: false };
    });
  }

  async markExpensePaid(
    businessId: string,
    expenseId: string,
    paidAt: ISODate,
    actorUid: string,
  ): Promise<ExpenseEntity> {
    assertISODate(paidAt, "paidAt");
    return this.store.runInTransaction(async (store) => {
      const expense = await this.requireDoc(
        store,
        businessId,
        "expenses",
        expenseId,
      );
      const transaction = await this.requireDoc(
        store,
        businessId,
        "transactions",
        expense.transactionId,
      );
      assertTransactionMutable(transaction);
      await this.assertPeriodOpen(store, businessId, transaction.date);
      await this.assertPeriodOpen(store, businessId, paidAt);
      await store.update(businessId, "expenses", expenseId, {
        paidAt,
        updatedAt: this.now(),
      });
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "update",
        "expenses",
        expenseId,
      );
      return this.requireDoc(store, businessId, "expenses", expenseId);
    });
  }

  async registerCustomer(
    businessId: string,
    input: { name: string; email?: string; address?: string },
    actorUid: string,
  ): Promise<CustomerEntity> {
    if (typeof input.name !== "string" || input.name.trim() === "") {
      throw new DomainError("VALIDATION_FAILED", "name must be non-empty");
    }
    return this.store.runInTransaction(async (store) => {
      const now = this.now();
      const id = this.newId();
      const customer: CustomerEntity = {
        id,
        name: input.name,
        email: input.email ?? null,
        address: input.address ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await store.create(businessId, "customers", id, customer);
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "create",
        "customers",
        id,
      );
      return customer;
    });
  }

  async registerProject(
    businessId: string,
    input: { customerId: string; name: string },
    actorUid: string,
  ): Promise<ProjectEntity> {
    if (typeof input.name !== "string" || input.name.trim() === "") {
      throw new DomainError("VALIDATION_FAILED", "name must be non-empty");
    }
    return this.store.runInTransaction(async (store) => {
      await this.requireDoc(store, businessId, "customers", input.customerId);
      const now = this.now();
      const id = this.newId();
      const project: ProjectEntity = {
        id,
        customerId: input.customerId,
        name: input.name,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      await store.create(businessId, "projects", id, project);
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "create",
        "projects",
        id,
      );
      return project;
    });
  }

  async registerInvoice(
    businessId: string,
    input: InvoiceInput & Idempotent,
    actorUid: string,
  ): Promise<RegisterInvoiceResult> {
    const totalAmount = validateInvoiceInput(input);
    return this.store.runInTransaction(async (store) => {
      const existing = await this.findIdempotent(
        store,
        businessId,
        "invoices",
        input.idempotencyKey,
      );
      if (existing) return { invoice: existing, deduplicated: true };

      await this.requireDoc(store, businessId, "customers", input.customerId);
      if (input.projectId !== undefined) {
        await this.requireDoc(store, businessId, "projects", input.projectId);
      }
      await this.assertPeriodOpen(store, businessId, input.issueDate);

      const now = this.now();
      const id = this.newId();
      const invoice: InvoiceEntity = {
        id,
        customerId: input.customerId,
        projectId: input.projectId ?? null,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        items: input.items,
        totalAmount,
        status: "draft",
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: now,
        updatedAt: now,
      };
      await store.create(businessId, "invoices", id, invoice);
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "create",
        "invoices",
        id,
      );
      return { invoice, deduplicated: false };
    });
  }

  async issueInvoice(
    businessId: string,
    invoiceId: string,
    actorUid: string,
  ): Promise<InvoiceEntity> {
    return this.store.runInTransaction(async (store) => {
      const invoice = await this.requireDoc(
        store,
        businessId,
        "invoices",
        invoiceId,
      );
      assertInvoiceIssuable(invoice);
      await this.assertPeriodOpen(store, businessId, invoice.issueDate);
      await store.update(businessId, "invoices", invoiceId, {
        status: "issued",
        updatedAt: this.now(),
      });
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "update",
        "invoices",
        invoiceId,
      );
      return this.requireDoc(store, businessId, "invoices", invoiceId);
    });
  }

  async recordPayment(
    businessId: string,
    input: PaymentInput & Idempotent,
    actorUid: string,
  ): Promise<RecordPaymentResult> {
    validatePaymentInput(input);
    return this.store.runInTransaction(async (store) => {
      const existing = await this.findIdempotent(
        store,
        businessId,
        "payments",
        input.idempotencyKey,
      );
      if (existing) {
        const invoice = await this.requireDoc(
          store,
          businessId,
          "invoices",
          existing.invoiceId,
        );
        return { payment: existing, invoice, deduplicated: true };
      }

      const invoice = await this.requireDoc(
        store,
        businessId,
        "invoices",
        input.invoiceId,
      );
      assertInvoicePayable(invoice.status);
      await this.assertPeriodOpen(store, businessId, input.date);
      if (input.transactionId !== undefined) {
        const transaction = await this.requireDoc(
          store,
          businessId,
          "transactions",
          input.transactionId,
        );
        if (transaction.type !== "income") {
          throw new DomainError(
            "VALIDATION_FAILED",
            "payment can only be linked to an income transaction",
          );
        }
      }

      const payments = await store.list(businessId, "payments");
      const paidAmount = payments
        .filter((payment) => payment.invoiceId === input.invoiceId)
        .reduce((sum, payment) => sum + payment.amount, 0);
      if (paidAmount + input.amount > invoice.totalAmount) {
        throw new DomainError(
          "PAYMENT_EXCEEDS_BALANCE",
          `payment of ${input.amount} exceeds outstanding balance ${invoice.totalAmount - paidAmount}`,
        );
      }

      const now = this.now();
      const id = this.newId();
      const payment: PaymentEntity = {
        id,
        invoiceId: input.invoiceId,
        date: input.date,
        amount: input.amount,
        transactionId: input.transactionId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: now,
      };
      await store.create(businessId, "payments", id, payment);
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "create",
        "payments",
        id,
      );

      let resultInvoice = invoice;
      if (paidAmount + input.amount === invoice.totalAmount) {
        await store.update(businessId, "invoices", invoice.id, {
          status: "paid",
          updatedAt: now,
        });
        await this.writeAudit(
          store,
          businessId,
          actorUid,
          "update",
          "invoices",
          invoice.id,
        );
        resultInvoice = await this.requireDoc(
          store,
          businessId,
          "invoices",
          invoice.id,
        );
      }
      return { payment, invoice: resultInvoice, deduplicated: false };
    });
  }

  async refreshInvoiceStatuses(
    businessId: string,
    asOf?: ISODate,
  ): Promise<InvoiceEntity[]> {
    const referenceDate = asOf ?? this.today();
    assertISODate(referenceDate, "asOf");
    return this.store.runInTransaction(async (store) => {
      const invoices = await store.list(businessId, "invoices");
      const updated: InvoiceEntity[] = [];
      for (const invoice of invoices) {
        if (invoice.status === "issued" && invoice.dueDate < referenceDate) {
          await store.update(businessId, "invoices", invoice.id, {
            status: "overdue",
            updatedAt: this.now(),
          });
          await this.writeAudit(
            store,
            businessId,
            "system",
            "update",
            "invoices",
            invoice.id,
          );
          updated.push(
            await this.requireDoc(store, businessId, "invoices", invoice.id),
          );
        }
      }
      return updated;
    });
  }

  async registerReceipt(
    businessId: string,
    input: ReceiptInput & Idempotent,
    actorUid: string,
  ): Promise<RegisterReceiptResult> {
    validateReceiptInput(input);
    return this.store.runInTransaction(async (store) => {
      const existing = await this.findIdempotent(
        store,
        businessId,
        "receipts",
        input.idempotencyKey,
      );
      if (existing) return { receipt: existing, deduplicated: true };

      const id = this.newId();
      const receipt: ReceiptEntity = {
        id,
        storagePath: input.storagePath,
        fileName: input.fileName,
        mimeType: input.mimeType,
        transactionId: null,
        status: "unprocessed",
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: actorUid,
        createdAt: this.now(),
      };
      await store.create(businessId, "receipts", id, receipt);
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "create",
        "receipts",
        id,
      );
      return { receipt, deduplicated: false };
    });
  }

  async linkReceipt(
    businessId: string,
    receiptId: string,
    transactionId: string,
    actorUid: string,
  ): Promise<{ receipt: ReceiptEntity; transaction: TransactionEntity }> {
    return this.store.runInTransaction(async (store) => {
      const receipt = await this.requireDoc(
        store,
        businessId,
        "receipts",
        receiptId,
      );
      const transaction = await this.requireDoc(
        store,
        businessId,
        "transactions",
        transactionId,
      );
      assertTransactionMutable(transaction);
      await this.assertPeriodOpen(store, businessId, transaction.date);

      if (
        receipt.status === "linked" &&
        receipt.transactionId === transactionId
      ) {
        return { receipt, transaction };
      }
      assertReceiptStatusTransition(receipt.status, "linked");

      await store.update(businessId, "receipts", receiptId, {
        status: "linked",
        transactionId,
      });
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "update",
        "receipts",
        receiptId,
      );

      const receiptIds = transaction.receiptIds.includes(receiptId)
        ? transaction.receiptIds
        : [...transaction.receiptIds, receiptId];
      await store.update(businessId, "transactions", transactionId, {
        receiptIds,
        updatedAt: this.now(),
      });
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "update",
        "transactions",
        transactionId,
      );
      return {
        receipt: await this.requireDoc(store, businessId, "receipts", receiptId),
        transaction: await this.requireDoc(
          store,
          businessId,
          "transactions",
          transactionId,
        ),
      };
    });
  }

  async unlinkReceipt(
    businessId: string,
    receiptId: string,
    actorUid: string,
  ): Promise<ReceiptEntity> {
    return this.store.runInTransaction(async (store) => {
      const receipt = await this.requireDoc(
        store,
        businessId,
        "receipts",
        receiptId,
      );
      assertReceiptStatusTransition(receipt.status, "unprocessed");
      const transactionId = receipt.transactionId;
      if (transactionId !== null) {
        const transaction = await this.requireDoc(
          store,
          businessId,
          "transactions",
          transactionId,
        );
        assertTransactionMutable(transaction);
        await this.assertPeriodOpen(store, businessId, transaction.date);
        await store.update(businessId, "transactions", transactionId, {
          receiptIds: transaction.receiptIds.filter((id) => id !== receiptId),
          updatedAt: this.now(),
        });
        await this.writeAudit(
          store,
          businessId,
          actorUid,
          "update",
          "transactions",
          transactionId,
        );
      }
      await store.update(businessId, "receipts", receiptId, {
        status: "unprocessed",
        transactionId: null,
      });
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "update",
        "receipts",
        receiptId,
      );
      return this.requireDoc(store, businessId, "receipts", receiptId);
    });
  }

  async archiveReceipt(
    businessId: string,
    receiptId: string,
    actorUid: string,
  ): Promise<ReceiptEntity> {
    return this.store.runInTransaction(async (store) => {
      const receipt = await this.requireDoc(
        store,
        businessId,
        "receipts",
        receiptId,
      );
      assertReceiptStatusTransition(receipt.status, "archived");
      if (receipt.transactionId !== null) {
        const transaction = await this.requireDoc(
          store,
          businessId,
          "transactions",
          receipt.transactionId,
        );
        assertTransactionMutable(transaction);
        await this.assertPeriodOpen(store, businessId, transaction.date);
        await store.update(businessId, "transactions", transaction.id, {
          receiptIds: transaction.receiptIds.filter((id) => id !== receiptId),
          updatedAt: this.now(),
        });
        await this.writeAudit(
          store,
          businessId,
          actorUid,
          "update",
          "transactions",
          transaction.id,
        );
      }
      await store.update(businessId, "receipts", receiptId, {
        status: "archived",
        transactionId: null,
      });
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "update",
        "receipts",
        receiptId,
      );
      return this.requireDoc(store, businessId, "receipts", receiptId);
    });
  }

  async recomputeMonthlySummary(
    businessId: string,
    yearMonth: YearMonth,
  ): Promise<MonthlySummaryEntity> {
    assertYearMonth(yearMonth, "yearMonth");
    return this.store.runInTransaction(async (store) => {
      const transactions = await store.list(businessId, "transactions");
      const summary = computeMonthlySummary(
        yearMonth,
        transactions,
        this.now(),
      );
      const existing = await store.get(
        businessId,
        "monthlySummaries",
        yearMonth,
      );
      if (existing) {
        await store.update(businessId, "monthlySummaries", yearMonth, summary);
      } else {
        await store.create(
          businessId,
          "monthlySummaries",
          yearMonth,
          summary,
        );
      }
      return summary;
    });
  }

  async getUnpaidInvoices(
    businessId: string,
    asOf?: ISODate,
  ): Promise<UnpaidInvoiceInfo[]> {
    const referenceDate = asOf ?? this.today();
    assertISODate(referenceDate, "asOf");
    const [invoices, payments] = await Promise.all([
      this.store.list(businessId, "invoices"),
      this.store.list(businessId, "payments"),
    ]);
    return listUnpaidInvoices(invoices, payments, referenceDate);
  }

  async getUnpaidExpenses(
    businessId: string,
    asOf?: ISODate,
  ): Promise<UnpaidExpenseInfo[]> {
    const referenceDate = asOf ?? this.today();
    assertISODate(referenceDate, "asOf");
    const [expenses, transactions] = await Promise.all([
      this.store.list(businessId, "expenses"),
      this.store.list(businessId, "transactions"),
    ]);
    return listUnpaidExpenses(expenses, transactions, referenceDate);
  }

  async createFiscalPeriod(
    businessId: string,
    input: { startDate: ISODate; endDate: ISODate },
    actorUid: string,
  ): Promise<FiscalPeriodEntity> {
    assertISODate(input.startDate, "startDate");
    assertISODate(input.endDate, "endDate");
    if (input.endDate < input.startDate) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "endDate must not be before startDate",
      );
    }
    return this.store.runInTransaction(async (store) => {
      const periods = await store.list(businessId, "fiscalPeriods");
      const overlaps = periods.some(
        (period) =>
          input.startDate <= period.endDate &&
          period.startDate <= input.endDate,
      );
      if (overlaps) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "fiscal period overlaps an existing period",
        );
      }
      const id = this.newId();
      const period: FiscalPeriodEntity = {
        id,
        startDate: input.startDate,
        endDate: input.endDate,
        status: "open",
        closedAt: null,
        closedBy: null,
        createdAt: this.now(),
      };
      await store.create(businessId, "fiscalPeriods", id, period);
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "create",
        "fiscalPeriods",
        id,
      );
      return period;
    });
  }

  async openFiscalYear(
    businessId: string,
    fiscalYear: number,
    fiscalYearStartMonth: number,
    actorUid: string,
  ): Promise<FiscalPeriodEntity> {
    const range = fiscalPeriodRange(fiscalYear, fiscalYearStartMonth);
    return this.createFiscalPeriod(businessId, range, actorUid);
  }

  async closeFiscalPeriod(
    businessId: string,
    periodId: string,
    actorUid: string,
  ): Promise<CloseFiscalPeriodResult> {
    return this.store.runInTransaction(async (store) => {
      const period = await this.requireDoc(
        store,
        businessId,
        "fiscalPeriods",
        periodId,
      );
      if (period.status === "closed") {
        throw new DomainError(
          "INVALID_STATE",
          `fiscal period ${periodId} is already closed`,
        );
      }
      const now = this.now();
      await store.update(businessId, "fiscalPeriods", periodId, {
        status: "closed",
        closedAt: now,
        closedBy: actorUid,
      });
      await this.writeAudit(
        store,
        businessId,
        actorUid,
        "close",
        "fiscalPeriods",
        periodId,
      );

      const transactions = await store.list(businessId, "transactions");
      const lockedTransactionIds: string[] = [];
      for (const transaction of transactions) {
        if (
          transaction.status === "locked" ||
          transaction.date < period.startDate ||
          transaction.date > period.endDate
        ) {
          continue;
        }
        await store.update(businessId, "transactions", transaction.id, {
          status: "locked",
          updatedAt: now,
        });
        await this.writeAudit(
          store,
          businessId,
          actorUid,
          "update",
          "transactions",
          transaction.id,
        );
        lockedTransactionIds.push(transaction.id);
      }

      return {
        period: await this.requireDoc(
          store,
          businessId,
          "fiscalPeriods",
          periodId,
        ),
        lockedTransactionIds,
      };
    });
  }

  async buildClosingChecklist(
    businessId: string,
    periodId: string,
  ): Promise<ClosingChecklist> {
    const period = await this.requireDoc(
      this.store,
      businessId,
      "fiscalPeriods",
      periodId,
    );
    const [transactions, expenses, invoices, payments, receipts] =
      await Promise.all([
        this.store.list(businessId, "transactions"),
        this.store.list(businessId, "expenses"),
        this.store.list(businessId, "invoices"),
        this.store.list(businessId, "payments"),
        this.store.list(businessId, "receipts"),
      ]);
    return buildClosingChecklist({
      period,
      transactions,
      expenses,
      invoices,
      payments,
      receipts,
    });
  }

  async findDuplicatesFor(
    businessId: string,
    transactionId: string,
  ): Promise<DuplicateCandidate[]> {
    const target = await this.requireDoc(
      this.store,
      businessId,
      "transactions",
      transactionId,
    );
    const transactions = await this.store.list(businessId, "transactions");
    return findDuplicateCandidates(
      target,
      transactions.filter((tx) => tx.id !== transactionId),
    );
  }

  async listAuditLogs(businessId: string): Promise<AuditLogEntity[]> {
    const logs = await this.store.list(businessId, "auditLogs");
    return logs.sort((a, b) => {
      const diff = a.createdAt.getTime() - b.createdAt.getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }
}
