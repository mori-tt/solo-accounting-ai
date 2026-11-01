"use server";

import {
  issueInvoice,
  refreshOverdueInvoices,
  registerCustomer,
  registerInvoice,
  registerPayment,
  registerProject,
} from "@/lib/accounting/services/sales";
import {
  auditsFor,
} from "@/lib/accounting/services/common";
import { DomainError } from "@/lib/accounting/errors";
import type {
  Customer,
  Invoice,
  InvoiceItem,
  Project,
  ProjectStatus,
} from "@/lib/accounting/types";
import {
  listCustomersRaw,
  listPaymentsRaw,
  listProjectsRaw,
} from "@/lib/api/queries";
import { ApiError, fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  customerSchema,
  invoiceSchema,
  parseForm,
  paymentSchema,
  projectSchema,
  type CustomerInput,
  type InvoiceInput,
  type PaymentInput,
  type ProjectInput,
} from "@/lib/validation/schemas";

export async function listCustomers(
  businessId: string,
): Promise<ActionResult<Customer[]>> {
  return run(async () => {
    await requireViewer(businessId);
    return (await listCustomersRaw(businessId)) as Customer[];
  });
}

export async function createCustomer(
  businessId: string,
  input: CustomerInput & { idempotencyKey?: string },
): Promise<ActionResult<Customer>> {
  const parsed = parseForm(customerSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { customer } = await registerCustomer(getStore(), businessId, actor, {
      name: parsed.data.name,
      email: parsed.data.email === "" ? undefined : parsed.data.email,
      address: parsed.data.address,
      idempotencyKey: input.idempotencyKey,
    });
    return customer;
  });
}

/** 顧客情報の更新 */
export async function updateCustomer(
  businessId: string,
  customerId: string,
  input: CustomerInput,
): Promise<ActionResult<Customer>> {
  const parsed = parseForm(customerSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const store = getStore();
    const { value } = await store.transact(businessId, {}, async (tx) => {
      const current = await tx.getCustomer(businessId, customerId);
      if (!current) {
        throw new DomainError("NOT_FOUND", `customer ${customerId} not found`);
      }
      const next: Customer = {
        ...current,
        name: parsed.data.name,
        email: parsed.data.email === "" ? undefined : parsed.data.email,
        address: parsed.data.address,
      };
      return {
        batch: {
          puts: [
            { collection: "customers" as const, id: customerId, data: next },
          ],
          audits: auditsFor(
            businessId,
            [{ collection: "customers", id: customerId }],
            "update",
            actor,
          ),
        },
        value: next,
      };
    });
    return value;
  });
}

export async function listProjects(
  businessId: string,
): Promise<ActionResult<Project[]>> {
  return run(async () => {
    await requireViewer(businessId);
    return (await listProjectsRaw(businessId)) as Project[];
  });
}

export async function createProject(
  businessId: string,
  input: ProjectInput & { idempotencyKey?: string },
): Promise<ActionResult<Project>> {
  const parsed = parseForm(projectSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { project } = await registerProject(getStore(), businessId, actor, {
      customerId: parsed.data.customerId,
      name: parsed.data.name,
      idempotencyKey: input.idempotencyKey,
    });
    return project;
  });
}

/** 案件名・ステータスの更新(customerIdは変更しない) */
export async function updateProject(
  businessId: string,
  projectId: string,
  input: { name: string; status: ProjectStatus },
): Promise<ActionResult<Project>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    if (!input.name) {
      throw new ApiError("INVALID_INPUT", "案件名を入力してください");
    }
    if (!["active", "done", "archived"].includes(input.status)) {
      throw new ApiError("INVALID_INPUT", "ステータスが不正です");
    }
    const store = getStore();
    const { value } = await store.transact(businessId, {}, async (tx) => {
      const current = await tx.getProject(businessId, projectId);
      if (!current) {
        throw new DomainError("NOT_FOUND", `project ${projectId} not found`);
      }
      const next: Project = { ...current, name: input.name, status: input.status };
      return {
        batch: {
          puts: [{ collection: "projects" as const, id: projectId, data: next }],
          audits: auditsFor(
            businessId,
            [{ collection: "projects", id: projectId }],
            "update",
            actor,
          ),
        },
        value: next,
      };
    });
    return value;
  });
}

export interface InvoiceRow {
  invoice: Invoice;
  paidAmount: number;
  remaining: number;
}

/** 請求書一覧(入金額・残額つき)。表示前に期限切れを overdue に更新する。 */
export async function listInvoiceRows(
  businessId: string,
  asOf: string,
): Promise<ActionResult<InvoiceRow[]>> {
  return run(async () => {
    const actor = await requireViewer(businessId);
    const store = getStore();
    // 期限切れのissuedをoverdueへ更新(冪等)。viewerには書き込み権がないため
    // editor以上の場合のみ最良努力で実行する
    if (actor.role !== "viewer") {
      try {
        await refreshOverdueInvoices(store, businessId, actor, asOf);
      } catch {
        // 表示を妨げない
      }
    }
    const invoices = await store.listInvoices(businessId);
    const payments = (await listPaymentsRaw(businessId)) as unknown as {
      invoiceId: string;
      amount: number;
    }[];
    const paidByInvoice = new Map<string, number>();
    for (const p of payments) {
      paidByInvoice.set(
        p.invoiceId,
        (paidByInvoice.get(p.invoiceId) ?? 0) + p.amount,
      );
    }
    const rows = invoices.map((invoice) => {
      const paidAmount = paidByInvoice.get(invoice.id) ?? 0;
      return { invoice, paidAmount, remaining: invoice.totalAmount - paidAmount };
    });
    rows.sort((a, b) => b.invoice.issueDate.localeCompare(a.invoice.issueDate));
    return rows;
  });
}

export async function createInvoice(
  businessId: string,
  input: InvoiceInput & { idempotencyKey: string },
): Promise<ActionResult<Invoice>> {
  const parsed = parseForm(invoiceSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const items: InvoiceItem[] = parsed.data.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.quantity * item.unitPrice,
      taxRate: item.taxRate,
    }));
    const { invoice } = await registerInvoice(getStore(), businessId, actor, {
      idempotencyKey: input.idempotencyKey,
      customerId: parsed.data.customerId,
      projectId: parsed.data.projectId === "" ? undefined : parsed.data.projectId,
      issueDate: parsed.data.issueDate,
      dueDate: parsed.data.dueDate,
      items,
    });
    return invoice;
  });
}

/** 請求書を発行する(draft → issued) */
export async function issueInvoiceAction(
  businessId: string,
  invoiceId: string,
): Promise<ActionResult<Invoice>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { invoice } = await issueInvoice(
      getStore(),
      businessId,
      actor,
      invoiceId,
    );
    return invoice;
  });
}

/** 入金の記録と消込 */
export async function registerPaymentAction(
  businessId: string,
  input: PaymentInput & { idempotencyKey: string },
): Promise<ActionResult<{ invoice: Invoice }>> {
  const parsed = parseForm(paymentSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { invoice } = await registerPayment(getStore(), businessId, actor, {
      idempotencyKey: input.idempotencyKey,
      invoiceId: parsed.data.invoiceId,
      date: parsed.data.date,
      amount: parsed.data.amount,
    });
    return { invoice };
  });
}
