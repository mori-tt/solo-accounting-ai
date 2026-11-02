"use server";

import {
  convertQuoteToInvoice,
  markQuoteAccepted,
  markQuoteSent,
  registerQuote,
  updateQuote,
} from "@/lib/accounting/services/quotes";
import type {
  Invoice,
  InvoiceItem,
  Quote,
} from "@/lib/accounting/types";
import {
  actionReadRateLimiter,
  actionWriteRateLimiter,
} from "@/lib/api/rate-limit";
import { fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  parseForm,
  quoteConvertSchema,
  quoteSchema,
  type QuoteConvertInput,
  type QuoteInput,
} from "@/lib/validation/schemas";

export interface QuoteRow {
  quote: Quote;
  /** status=converted のとき転換先請求書の請求書番号 */
  convertedInvoiceNumber?: string;
}

/** 見積一覧(発行日降順)。converted 見積には転換先の請求書番号を付ける。 */
export async function listQuoteRows(
  businessId: string,
): Promise<ActionResult<QuoteRow[]>> {
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const store = getStore();
    const [quotes, invoices] = await Promise.all([
      store.listQuotes(businessId),
      store.listInvoices(businessId),
    ]);
    const invoiceNumberById = new Map(
      invoices.map((i) => [i.id, i.invoiceNumber] as const),
    );
    const rows: QuoteRow[] = quotes.map((quote) => ({
      quote,
      convertedInvoiceNumber: quote.convertedInvoiceId
        ? invoiceNumberById.get(quote.convertedInvoiceId)
        : undefined,
    }));
    rows.sort((a, b) => b.quote.issueDate.localeCompare(a.quote.issueDate));
    return rows;
  });
}

export async function createQuote(
  businessId: string,
  input: QuoteInput & { idempotencyKey: string },
): Promise<ActionResult<Quote>> {
  const parsed = parseForm(quoteSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { quote } = await registerQuote(getStore(), businessId, actor, {
      idempotencyKey: input.idempotencyKey,
      customerId: parsed.data.customerId,
      projectId: parsed.data.projectId === "" ? undefined : parsed.data.projectId,
      issueDate: parsed.data.issueDate,
      validUntil: parsed.data.validUntil,
      items: toInvoiceItems(parsed.data.items),
      notes: parsed.data.notes === "" ? undefined : parsed.data.notes,
    });
    return quote;
  });
}

/** draft の見積を更新する(送付済み以降は不可) */
export async function updateQuoteAction(
  businessId: string,
  quoteId: string,
  input: QuoteInput,
): Promise<ActionResult<Quote>> {
  const parsed = parseForm(quoteSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { quote } = await updateQuote(
      getStore(),
      businessId,
      actor,
      quoteId,
      {
        customerId: parsed.data.customerId,
        projectId:
          parsed.data.projectId === "" ? undefined : parsed.data.projectId,
        issueDate: parsed.data.issueDate,
        validUntil: parsed.data.validUntil,
        items: toInvoiceItems(parsed.data.items),
        notes: parsed.data.notes === "" ? undefined : parsed.data.notes,
      },
    );
    return quote;
  });
}

/** 見積を送付済みにする(draft → sent) */
export async function markQuoteSentAction(
  businessId: string,
  quoteId: string,
): Promise<ActionResult<Quote>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { quote } = await markQuoteSent(
      getStore(),
      businessId,
      actor,
      quoteId,
    );
    return quote;
  });
}

/** 見積を受注済みにする(sent → accepted) */
export async function markQuoteAcceptedAction(
  businessId: string,
  quoteId: string,
): Promise<ActionResult<Quote>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { quote } = await markQuoteAccepted(
      getStore(),
      businessId,
      actor,
      quoteId,
    );
    return quote;
  });
}

/**
 * 見積→請求書転換。明細を請求書へコピーし invoice.quoteId と
 * quote.status=converted を記録する。生成される請求書は draft。
 */
export async function convertQuoteAction(
  businessId: string,
  quoteId: string,
  input: QuoteConvertInput & { idempotencyKey: string },
): Promise<ActionResult<Invoice>> {
  const parsed = parseForm(quoteConvertSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { invoice } = await convertQuoteToInvoice(
      getStore(),
      businessId,
      actor,
      quoteId,
      {
        idempotencyKey: input.idempotencyKey,
        issueDate: parsed.data.issueDate,
        dueDate: parsed.data.dueDate,
      },
    );
    return invoice;
  });
}

function toInvoiceItems(
  items: QuoteInput["items"],
): InvoiceItem[] {
  return items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: item.quantity * item.unitPrice,
    taxRate: item.taxRate,
  }));
}
