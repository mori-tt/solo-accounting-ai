"use server";

import {
  generateRecurringTransactions,
  registerRecurringTemplate,
  setRecurringTemplateActive,
  updateRecurringTemplate,
} from "@/lib/accounting/services/recurring";
import type { RecurringTemplate } from "@/lib/accounting/types";
import { fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  monthKey,
  parseForm,
  recurringTemplateSchema,
  recurringTemplateUpdateSchema,
  type RecurringTemplateInput,
  type RecurringTemplateUpdateInput,
} from "@/lib/validation/schemas";

function sortTemplates(list: RecurringTemplate[]): RecurringTemplate[] {
  return [...list].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export async function listRecurringTemplates(
  businessId: string,
): Promise<ActionResult<RecurringTemplate[]>> {
  return run(async () => {
    await requireViewer(businessId);
    const list = await getStore().listRecurringTemplates(businessId);
    return sortTemplates(list);
  });
}

export async function createRecurringTemplate(
  businessId: string,
  input: RecurringTemplateInput & { idempotencyKey: string },
): Promise<ActionResult<RecurringTemplate>> {
  const parsed = parseForm(recurringTemplateSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { template } = await registerRecurringTemplate(
      getStore(),
      businessId,
      actor,
      {
        idempotencyKey: input.idempotencyKey,
        name: parsed.data.name,
        type: parsed.data.type,
        account: parsed.data.account,
        counterparty: parsed.data.counterparty,
        description: parsed.data.description,
        amount: parsed.data.amount,
        dayOfMonth: parsed.data.dayOfMonth,
      },
    );
    return template;
  });
}

/** テンプレート内容の更新(active切り替えを含む) */
export async function updateRecurringTemplateAction(
  businessId: string,
  templateId: string,
  input: RecurringTemplateUpdateInput,
): Promise<ActionResult<RecurringTemplate>> {
  const parsed = parseForm(recurringTemplateUpdateSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { template } = await updateRecurringTemplate(
      getStore(),
      businessId,
      actor,
      templateId,
      {
        name: parsed.data.name,
        type: parsed.data.type,
        account: parsed.data.account,
        counterparty: parsed.data.counterparty,
        description: parsed.data.description,
        amount: parsed.data.amount,
        dayOfMonth: parsed.data.dayOfMonth,
        active: parsed.data.active,
      },
    );
    return template;
  });
}

/** テンプレートの有効化/無効化 */
export async function setRecurringTemplateActiveAction(
  businessId: string,
  templateId: string,
  active: boolean,
): Promise<ActionResult<RecurringTemplate>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { template } = await setRecurringTemplateActive(
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
 * 指定月(yyyyMM)分の取引を一括生成する。
 * 当月未生成の active テンプレートのみ対象(lastGeneratedMonthで管理)。
 */
export async function generateRecurringForMonth(
  businessId: string,
  input: { monthKey: string },
): Promise<ActionResult<{ created: number }>> {
  const parsed = parseForm(monthKey, input.monthKey);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { transactions } = await generateRecurringTransactions(
      getStore(),
      businessId,
      actor,
      parsed.data,
    );
    return { created: transactions.length };
  });
}
