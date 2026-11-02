"use server";

import {
  generateRecurringInvoices,
  registerRecurringInvoiceTemplate,
  setRecurringInvoiceTemplateActive,
  updateRecurringInvoiceTemplate,
} from "@/lib/accounting/services/recurring-invoices";
import type {
  InvoiceItem,
  RecurringInvoiceTemplate,
} from "@/lib/accounting/types";
import {
  actionBulkRateLimiter,
  actionReadRateLimiter,
  actionWriteRateLimiter,
} from "@/lib/api/rate-limit";
import { fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  monthKey,
  parseForm,
  recurringInvoiceTemplateSchema,
  recurringInvoiceTemplateUpdateSchema,
  type RecurringInvoiceTemplateInput,
  type RecurringInvoiceTemplateUpdateInput,
} from "@/lib/validation/schemas";

function sortTemplates(
  list: RecurringInvoiceTemplate[],
): RecurringInvoiceTemplate[] {
  return [...list].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** フォームの空文字・未指定をドメインの undefined へ正規化する */
function toServiceFields(input: {
  projectId?: string;
  endDate?: string;
  items: { description: string; quantity: number; unitPrice: number; taxRate?: "standard" | "reduced" }[];
}) {
  const items: InvoiceItem[] = input.items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: item.quantity * item.unitPrice,
    taxRate: item.taxRate,
  }));
  return {
    projectId: input.projectId === "" ? undefined : input.projectId,
    endDate: input.endDate === "" ? undefined : input.endDate,
    items,
  };
}

export async function listRecurringInvoiceTemplates(
  businessId: string,
): Promise<ActionResult<RecurringInvoiceTemplate[]>> {
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const list = await getStore().listRecurringInvoiceTemplates(businessId);
    return sortTemplates(list);
  });
}

export async function createRecurringInvoiceTemplate(
  businessId: string,
  input: RecurringInvoiceTemplateInput & { idempotencyKey: string },
): Promise<ActionResult<RecurringInvoiceTemplate>> {
  const parsed = parseForm(recurringInvoiceTemplateSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const extra = toServiceFields(parsed.data);
    const { template } = await registerRecurringInvoiceTemplate(
      getStore(),
      businessId,
      actor,
      {
        idempotencyKey: input.idempotencyKey,
        name: parsed.data.name,
        customerId: parsed.data.customerId,
        projectId: extra.projectId,
        items: extra.items,
        intervalMonths: parsed.data.intervalMonths,
        dayOfMonth: parsed.data.dayOfMonth,
        startDate: parsed.data.startDate,
        endDate: extra.endDate,
        maxOccurrences: parsed.data.maxOccurrences,
        dueDays: parsed.data.dueDays,
      },
    );
    return template;
  });
}

/** テンプレート内容の更新(active切り替えを含む) */
export async function updateRecurringInvoiceTemplateAction(
  businessId: string,
  templateId: string,
  input: RecurringInvoiceTemplateUpdateInput,
): Promise<ActionResult<RecurringInvoiceTemplate>> {
  const parsed = parseForm(recurringInvoiceTemplateUpdateSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const extra = toServiceFields(parsed.data);
    const { template } = await updateRecurringInvoiceTemplate(
      getStore(),
      businessId,
      actor,
      templateId,
      {
        name: parsed.data.name,
        customerId: parsed.data.customerId,
        projectId: extra.projectId,
        items: extra.items,
        intervalMonths: parsed.data.intervalMonths,
        dayOfMonth: parsed.data.dayOfMonth,
        startDate: parsed.data.startDate,
        endDate: extra.endDate,
        maxOccurrences: parsed.data.maxOccurrences,
        dueDays: parsed.data.dueDays,
        active: parsed.data.active,
      },
    );
    return template;
  });
}

/** テンプレートの有効化/無効化 */
export async function setRecurringInvoiceTemplateActiveAction(
  businessId: string,
  templateId: string,
  active: boolean,
): Promise<ActionResult<RecurringInvoiceTemplate>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { template } = await setRecurringInvoiceTemplateActive(
      getStore(),
      businessId,
      actor,
      templateId,
      active,
    );
    return template;
  });
}

/**
 * 指定月(yyyyMM)分の請求書を一括生成する。
 * 当月未処理の active テンプレートのみ対象(lastGeneratedMonthで管理)。
 */
export async function generateRecurringInvoicesForMonth(
  businessId: string,
  input: { monthKey: string },
): Promise<ActionResult<{ created: number }>> {
  const parsed = parseForm(monthKey, input.monthKey);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionBulkRateLimiter.consume(businessId);
    const { invoices } = await generateRecurringInvoices(
      getStore(),
      businessId,
      actor,
      parsed.data,
    );
    return { created: invoices.length };
  });
}
