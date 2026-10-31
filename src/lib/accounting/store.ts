import type {
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

export interface EntityByCollection {
  transactions: TransactionEntity;
  expenses: ExpenseEntity;
  receipts: ReceiptEntity;
  customers: CustomerEntity;
  projects: ProjectEntity;
  invoices: InvoiceEntity;
  payments: PaymentEntity;
  monthlySummaries: MonthlySummaryEntity;
  fiscalPeriods: FiscalPeriodEntity;
  auditLogs: AuditLogEntity;
}

export type CollectionName = keyof EntityByCollection;

export const IDEMPOTENT_COLLECTIONS = [
  "transactions",
  "invoices",
  "payments",
  "receipts",
] as const;

export type IdempotentCollection = (typeof IDEMPOTENT_COLLECTIONS)[number];

export interface AccountingStore {
  get<C extends CollectionName>(
    businessId: string,
    collection: C,
    id: string,
  ): Promise<EntityByCollection[C] | null>;

  list<C extends CollectionName>(
    businessId: string,
    collection: C,
  ): Promise<EntityByCollection[C][]>;

  create<C extends CollectionName>(
    businessId: string,
    collection: C,
    id: string,
    entity: EntityByCollection[C],
  ): Promise<void>;

  update<C extends CollectionName>(
    businessId: string,
    collection: C,
    id: string,
    patch: Partial<EntityByCollection[C]>,
  ): Promise<void>;

  remove<C extends CollectionName>(
    businessId: string,
    collection: C,
    id: string,
  ): Promise<void>;

  findByIdempotencyKey(
    businessId: string,
    collection: IdempotentCollection,
    key: string,
  ): Promise<string | null>;

  runInTransaction<T>(
    fn: (store: AccountingStore) => Promise<T>,
  ): Promise<T>;
}
