import { assertDateString } from "../dates";
import { DomainError } from "../errors";
import {
  computeInvoiceTotals,
  invoiceItemTaxAmount,
  isInvoiceTaxRate,
} from "../invoice-tax";
import { assertNonNegativeYen, assertYenAmount } from "../money";
import type { AccountingReader, AccountingStore, PutOp } from "../store/types";
import type {
  Customer,
  Invoice,
  InvoiceItem,
  Payment,
  Project,
} from "../types";
import {
  assertDateInOpenPeriod,
  auditsFor,
  newId,
  nowOf,
  type ActorContext,
} from "./common";

export interface RegisterCustomerInput {
  id?: string;
  name: string;
  email?: string;
  address?: string;
  idempotencyKey?: string;
}

export async function registerCustomer(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterCustomerInput,
): Promise<{ customer: Customer; replayed: boolean }> {
  if (!input.name) {
    throw new DomainError("INVALID_INPUT", "name is required");
  }
  const id = input.id ?? newId();
  const customer: Customer = {
    id,
    name: input.name,
    email: input.email,
    address: input.address,
    createdAt: nowOf(actor),
  };
  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: input.idempotencyKey },
    async () => ({
      batch: {
        puts: [{ collection: "customers", id, data: customer }],
        audits: auditsFor(
          businessId,
          [{ collection: "customers", id }],
          "create",
          actor,
        ),
      },
      value: customer,
    }),
  );
  return { customer: value, replayed };
}

export interface RegisterProjectInput {
  id?: string;
  customerId: string;
  name: string;
  idempotencyKey?: string;
}

export async function registerProject(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterProjectInput,
): Promise<{ project: Project; replayed: boolean }> {
  if (!input.name) {
    throw new DomainError("INVALID_INPUT", "name is required");
  }
  const id = input.id ?? newId();
  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: input.idempotencyKey },
    async (tx) => {
      const customer = await tx.getCustomer(businessId, input.customerId);
      if (!customer) {
        throw new DomainError(
          "NOT_FOUND",
          `customer ${input.customerId} not found`,
        );
      }
      const project: Project = {
        id,
        customerId: input.customerId,
        name: input.name,
        status: "active",
        createdAt: nowOf(actor),
      };
      return {
        batch: {
          puts: [{ collection: "projects", id, data: project }],
          audits: auditsFor(
            businessId,
            [{ collection: "projects", id }],
            "create",
            actor,
          ),
        },
        value: project,
      };
    },
  );
  return { project: value, replayed };
}

export interface RegisterInvoiceInput {
  id?: string;
  /** リトライ安全のため必須 */
  idempotencyKey: string;
  customerId: string;
  projectId?: string;
  issueDate: string;
  dueDate: string;
  items: InvoiceItem[];
  /**
   * 指定された場合は items から再計算した合計と一致を検証する。
   * クライアント計算値の鵜呑みを防ぐ。
   */
  totalAmount?: number;
  /** totalAmount と同様に再計算値との一致を検証する */
  taxAmount?: number;
}

/**
 * 明細を検証し、税率の既定値適用と消費税額(税込の内税)を付与した
 * 正規化済み明細と合計を返す。税額算出は invoice-tax 経由で
 * domain/tax のエンジンを使う(再実装しない)。
 */
function normalizeInvoiceItems(items: InvoiceItem[]): {
  items: InvoiceItem[];
  totalAmount: number;
  taxAmount: number;
} {
  if (!Array.isArray(items) || items.length === 0) {
    throw new DomainError("INVALID_INPUT", "invoice requires at least one item");
  }
  const normalized: InvoiceItem[] = items.map((item, index) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new DomainError(
        "INVALID_QUANTITY",
        `items[${index}].quantity must be a positive integer`,
      );
    }
    assertNonNegativeYen(item.unitPrice, `items[${index}].unitPrice`);
    assertNonNegativeYen(item.amount, `items[${index}].amount`);
    const expected = item.quantity * item.unitPrice;
    if (item.amount !== expected) {
      throw new DomainError(
        "AMOUNT_MISMATCH",
        `items[${index}].amount ${item.amount} != quantity*unitPrice ${expected}`,
      );
    }
    if (item.taxRate !== undefined && !isInvoiceTaxRate(item.taxRate)) {
      throw new DomainError(
        "INVALID_INPUT",
        `items[${index}].taxRate must be one of standard/reduced`,
      );
    }
    const taxAmount = invoiceItemTaxAmount(item);
    if (item.taxAmount !== undefined && item.taxAmount !== taxAmount) {
      throw new DomainError(
        "AMOUNT_MISMATCH",
        `items[${index}].taxAmount ${item.taxAmount} != computed ${taxAmount}`,
      );
    }
    return { ...item, taxRate: item.taxRate ?? "standard", taxAmount };
  });
  const { totalAmount, taxAmount } = computeInvoiceTotals(normalized);
  return { items: normalized, totalAmount, taxAmount };
}

/** 請求書を draft として登録する。合計は items から再計算する。 */
export async function registerInvoice(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterInvoiceInput,
): Promise<{ invoice: Invoice; replayed: boolean }> {
  const issueDate = assertDateString(input.issueDate, "issueDate");
  const dueDate = assertDateString(input.dueDate, "dueDate");
  if (dueDate < issueDate) {
    throw new DomainError(
      "DUE_BEFORE_ISSUE",
      `dueDate ${dueDate} is before issueDate ${issueDate}`,
    );
  }
  const normalized = normalizeInvoiceItems(input.items);
  const { totalAmount, taxAmount } = normalized;
  if (input.totalAmount !== undefined && input.totalAmount !== totalAmount) {
    throw new DomainError(
      "AMOUNT_MISMATCH",
      `totalAmount ${input.totalAmount} != computed ${totalAmount}`,
    );
  }
  if (input.taxAmount !== undefined && input.taxAmount !== taxAmount) {
    throw new DomainError(
      "AMOUNT_MISMATCH",
      `taxAmount ${input.taxAmount} != computed ${taxAmount}`,
    );
  }

  const id = input.id ?? newId();
  const at = nowOf(actor);
  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: input.idempotencyKey },
    async (tx) => {
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(issueDate, periods);

      const customer = await tx.getCustomer(businessId, input.customerId);
      if (!customer) {
        throw new DomainError(
          "NOT_FOUND",
          `customer ${input.customerId} not found`,
        );
      }
      if (input.projectId !== undefined) {
        const project = await tx.getProject(businessId, input.projectId);
        if (!project) {
          throw new DomainError(
            "NOT_FOUND",
            `project ${input.projectId} not found`,
          );
        }
      }

      const invoice: Invoice = {
        id,
        customerId: input.customerId,
        projectId: input.projectId,
        issueDate,
        dueDate,
        items: normalized.items,
        totalAmount,
        taxAmount,
        status: "draft",
        createdAt: at,
        updatedAt: at,
      };
      return {
        batch: {
          puts: [{ collection: "invoices", id, data: invoice }],
          audits: auditsFor(
            businessId,
            [{ collection: "invoices", id }],
            "create",
            actor,
          ),
        },
        value: invoice,
      };
    },
  );
  return { invoice: value, replayed };
}

/** draft → issued。issued/paid/overdue への再実行は冪等に成功。 */
export async function issueInvoice(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  invoiceId: string,
): Promise<{ invoice: Invoice }> {
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getInvoice(businessId, invoiceId);
    if (!current) {
      throw new DomainError("NOT_FOUND", `invoice ${invoiceId} not found`);
    }
    if (current.status !== "draft") {
      return { batch: { puts: [], audits: [] }, value: current };
    }
    const periods = await tx.listFiscalPeriods(businessId);
    assertDateInOpenPeriod(current.issueDate, periods);

    const next: Invoice = {
      ...current,
      status: "issued",
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [{ collection: "invoices", id: invoiceId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "invoices", id: invoiceId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { invoice: value };
}

export interface RegisterPaymentInput {
  id?: string;
  /** リトライ安全のため必須 */
  idempotencyKey: string;
  invoiceId: string;
  /** 入金日 YYYY-MM-DD */
  date: string;
  /** 円・整数・正数。部分入金可、超過入金は不可 */
  amount: number;
  /** 対応する入金Transaction */
  transactionId?: string;
}

/**
 * 入金の記録と消込。
 * 累計入金額が請求額に達したら invoice を paid にする。
 * 同時実行でも過入金にならないよう、既存入金はトランザクション内で集計する。
 */
export async function registerPayment(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterPaymentInput,
): Promise<{ payment: Payment; invoice: Invoice; replayed: boolean }> {
  const date = assertDateString(input.date);
  const amount = assertYenAmount(input.amount);

  const paymentId = input.id ?? newId();
  const at = nowOf(actor);

  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: input.idempotencyKey },
    async (tx) => {
      const invoice = await tx.getInvoice(businessId, input.invoiceId);
      if (!invoice) {
        throw new DomainError(
          "NOT_FOUND",
          `invoice ${input.invoiceId} not found`,
        );
      }
      if (invoice.status === "draft") {
        throw new DomainError(
          "INVALID_STATUS_TRANSITION",
          `invoice ${input.invoiceId} is still draft`,
        );
      }
      if (invoice.status === "paid") {
        throw new DomainError(
          "ALREADY_PAID",
          `invoice ${input.invoiceId} is already fully paid`,
        );
      }
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(date, periods);

      const payments = await tx.listPaymentsForInvoice(
        businessId,
        input.invoiceId,
      );
      const paidSoFar = payments.reduce((sum, p) => sum + p.amount, 0);
      if (paidSoFar + amount > invoice.totalAmount) {
        throw new DomainError(
          "OVERPAID",
          `payment exceeds invoice total: paid ${paidSoFar} + ${amount} > ${invoice.totalAmount}`,
        );
      }

      const payment: Payment = {
        id: paymentId,
        invoiceId: input.invoiceId,
        date,
        amount,
        transactionId: input.transactionId,
        createdAt: at,
      };
      const paidTotal = paidSoFar + amount;
      const invoiceNext: Invoice = {
        ...invoice,
        status: paidTotal === invoice.totalAmount ? "paid" : invoice.status,
        updatedAt: at,
      };
      const puts: PutOp[] = [
        { collection: "payments", id: paymentId, data: payment },
      ];
      const auditTargets: { collection: "payments" | "invoices"; id: string }[] =
        [{ collection: "payments", id: paymentId }];
      if (invoiceNext.status !== invoice.status) {
        puts.push({
          collection: "invoices",
          id: invoice.id,
          data: invoiceNext,
        });
        auditTargets.push({ collection: "invoices", id: invoice.id });
      }
      return {
        batch: {
          puts,
          audits: auditsFor(businessId, auditTargets, "create", actor),
        },
        value: { payment, invoice: invoiceNext },
      };
    },
  );
  return { ...value, replayed };
}

export interface UnpaidInvoice {
  invoice: Invoice;
  paidAmount: number;
  remaining: number;
  /** dueDate を基準日が過ぎているか */
  overdue: boolean;
}

/**
 * 未入金Invoiceの検出。
 * 発行済みで入金合計が totalAmount 未満のものを返す。
 * status=overdue 未更新でも dueDate 超過は overdue=true で検出する。
 */
export async function findUnpaidInvoices(
  reader: AccountingReader,
  businessId: string,
  asOf: string,
): Promise<UnpaidInvoice[]> {
  const asOfDate = assertDateString(asOf, "asOf");
  const invoices = await reader.listInvoices(businessId);
  const result: UnpaidInvoice[] = [];
  for (const invoice of invoices) {
    if (invoice.status === "draft") continue;
    const payments = await reader.listPaymentsForInvoice(
      businessId,
      invoice.id,
    );
    const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    if (paidAmount >= invoice.totalAmount) continue;
    result.push({
      invoice,
      paidAmount,
      remaining: invoice.totalAmount - paidAmount,
      overdue: invoice.dueDate <= asOfDate,
    });
  }
  return result;
}

/**
 * 発行済みで dueDate を過ぎた請求書を overdue に更新する。
 * 定期実行(job)や画面表示前のリフレッシュに使う。
 */
export async function refreshOverdueInvoices(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  asOf: string,
): Promise<{ updated: Invoice[] }> {
  const asOfDate = assertDateString(asOf, "asOf");
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const invoices = await tx.listInvoices(businessId);
    const targets = invoices.filter(
      (i) => i.status === "issued" && i.dueDate <= asOfDate,
    );
    const updated = targets.map((i) => ({
      ...i,
      status: "overdue" as const,
      updatedAt: nowOf(actor),
    }));
    return {
      batch: {
        puts: updated.map((i) => ({
          collection: "invoices" as const,
          id: i.id,
          data: i,
        })),
        audits: auditsFor(
          businessId,
          updated.map((i) => ({ collection: "invoices" as const, id: i.id })),
          "update",
          actor,
        ),
      },
      value: updated,
    };
  });
  return { updated: value };
}
