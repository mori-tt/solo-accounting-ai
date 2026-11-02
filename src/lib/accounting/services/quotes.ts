import { assertDateString } from "../dates";
import { DomainError } from "../errors";
import type { AccountingStore } from "../store/types";
import type { Invoice, InvoiceItem, Quote } from "../types";
import {
  assertDateInOpenPeriod,
  auditsFor,
  newId,
  nowOf,
  scopedIdempotencyKey,
  type ActorContext,
} from "./common";
import { formatInvoiceNumber, normalizeInvoiceItems } from "./sales";

/**
 * 見積書。帳票系ドメインの一種だが会計仕訳を持たないため、
 * 締めへの影響は無い。ただし発行日の締め済み期間への混入は
 * 請求書と同じく拒否する(締め済み期間のデータを変更しない)。
 * ステータス遷移: draft → sent → accepted → converted。
 * converted 以降の帳票内容変更はしない(請求書は転換済み見積から派生)。
 */

export interface RegisterQuoteInput {
  id?: string;
  /** リトライ安全のため必須 */
  idempotencyKey: string;
  customerId: string;
  projectId?: string;
  issueDate: string;
  /** 見積有効期限 YYYY-MM-DD */
  validUntil: string;
  items: InvoiceItem[];
  notes?: string;
  /** 指定時は items からの再計算値と一致を検証する */
  totalAmount?: number;
  taxAmount?: number;
}

/** 見積番号の採番形式。事業内連番を `EST-` + 6桁ゼロ埋めで表す。 */
export function formatQuoteNumber(seq: number): string {
  return `EST-${String(seq).padStart(6, "0")}`;
}

function assertQuoteDates(
  issueDate: string,
  validUntil: string,
): { issueDate: string; validUntil: string } {
  const issue = assertDateString(issueDate, "issueDate");
  const valid = assertDateString(validUntil, "validUntil");
  if (valid < issue) {
    throw new DomainError(
      "INVALID_INPUT",
      `validUntil ${valid} is before issueDate ${issue}`,
    );
  }
  return { issueDate: issue, validUntil: valid };
}

/** 見積を draft として登録する。合計は items から再計算する。 */
export async function registerQuote(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterQuoteInput,
): Promise<{ quote: Quote; replayed: boolean }> {
  const { issueDate, validUntil } = assertQuoteDates(
    input.issueDate,
    input.validUntil,
  );
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
    { idempotencyKey: scopedIdempotencyKey("quote", input.idempotencyKey) },
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

      // 見積番号は事業ドキュメントのカウンタから連番採番する
      // (請求書番号と同じ仕組み。採番もtransact内で原子的に進む)
      const business = await tx.getBusiness(businessId);
      if (!business) {
        throw new DomainError(
          "NOT_FOUND",
          `business ${businessId} not found`,
        );
      }
      const seq = (business.quoteCounter ?? 0) + 1;

      const quote: Quote = {
        id,
        quoteNumber: formatQuoteNumber(seq),
        customerId: input.customerId,
        projectId: input.projectId,
        issueDate,
        validUntil,
        items: normalized.items,
        totalAmount,
        taxAmount,
        notes: input.notes,
        status: "draft",
        createdAt: at,
        updatedAt: at,
      };
      return {
        batch: {
          puts: [
            { collection: "quotes", id, data: quote },
            {
              collection: "businesses",
              id: businessId,
              data: { ...business, quoteCounter: seq, updatedAt: at },
            },
          ],
          audits: auditsFor(
            businessId,
            [{ collection: "quotes", id }],
            "create",
            actor,
          ),
        },
        value: quote,
      };
    },
  );
  return { quote: value, replayed };
}

export interface UpdateQuoteInput {
  customerId: string;
  projectId?: string;
  issueDate: string;
  validUntil: string;
  items: InvoiceItem[];
  notes?: string;
}

/**
 * draft の見積を更新する。送付済み以降は帳票の確定扱いのため変更しない
 * (転換・送付の取り消しも行わない)。合計は items から再計算する。
 */
export async function updateQuote(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  quoteId: string,
  input: UpdateQuoteInput,
): Promise<{ quote: Quote }> {
  const { issueDate, validUntil } = assertQuoteDates(
    input.issueDate,
    input.validUntil,
  );
  const normalized = normalizeInvoiceItems(input.items);
  const at = nowOf(actor);
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getQuote(businessId, quoteId);
    if (!current) {
      throw new DomainError("NOT_FOUND", `quote ${quoteId} not found`);
    }
    if (current.status !== "draft") {
      throw new DomainError(
        "INVALID_STATUS_TRANSITION",
        `quote ${quoteId} is ${current.status}, not draft`,
      );
    }
    const periods = await tx.listFiscalPeriods(businessId);
    assertDateInOpenPeriod(issueDate, periods);
    assertDateInOpenPeriod(current.issueDate, periods);

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

    const next: Quote = {
      ...current,
      customerId: input.customerId,
      projectId: input.projectId,
      issueDate,
      validUntil,
      items: normalized.items,
      totalAmount: normalized.totalAmount,
      taxAmount: normalized.taxAmount,
      notes: input.notes,
      updatedAt: at,
    };
    return {
      batch: {
        puts: [{ collection: "quotes", id: quoteId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "quotes", id: quoteId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { quote: value };
}

/** draft → sent。sent/accepted/converted への再実行は冪等に成功。 */
export async function markQuoteSent(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  quoteId: string,
): Promise<{ quote: Quote }> {
  return transitionQuote(store, businessId, actor, quoteId, "sent", ["draft"]);
}

/** sent → accepted。accepted/converted への再実行は冪等に成功。 */
export async function markQuoteAccepted(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  quoteId: string,
): Promise<{ quote: Quote }> {
  return transitionQuote(store, businessId, actor, quoteId, "accepted", [
    "sent",
  ]);
}

async function transitionQuote(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  quoteId: string,
  next: "sent" | "accepted",
  allowedFrom: readonly ("draft" | "sent")[],
): Promise<{ quote: Quote }> {
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getQuote(businessId, quoteId);
    if (!current) {
      throw new DomainError("NOT_FOUND", `quote ${quoteId} not found`);
    }
    // 既に同じステータス or 次段以降(accepted/converted)への再実行は冪等に返す
    if (current.status === next || (current.status !== "draft" && current.status !== "sent")) {
      return { batch: { puts: [], audits: [] }, value: current };
    }
    if (!allowedFrom.includes(current.status)) {
      throw new DomainError(
        "INVALID_STATUS_TRANSITION",
        `quote ${quoteId} cannot become ${next} from ${current.status}`,
      );
    }
    const updated: Quote = {
      ...current,
      status: next,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [{ collection: "quotes", id: quoteId, data: updated }],
        audits: auditsFor(
          businessId,
          [{ collection: "quotes", id: quoteId }],
          "update",
          actor,
        ),
      },
      value: updated,
    };
  });
  return { quote: value };
}

export interface ConvertQuoteInput {
  /** リトライ安全のため必須 */
  idempotencyKey: string;
  /** 生成する請求書の発行日 YYYY-MM-DD */
  issueDate: string;
  /** 生成する請求書の支払期日 YYYY-MM-DD */
  dueDate: string;
}

/**
 * 見積 → 請求書への転換。
 * 明細・顧客・案件を請求書へコピーし、invoice.quoteId と
 * quote.status=converted + convertedInvoiceId を同一トランザクションで
 * 書き込む(不整合な転換状態を残さない)。採番は請求書番号の連番を共有する。
 * sent/accepted のみ転換可。converted への再実行は既存請求書を冪等に返す。
 */
export async function convertQuoteToInvoice(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  quoteId: string,
  input: ConvertQuoteInput,
): Promise<{ invoice: Invoice; quote: Quote; replayed: boolean }> {
  const issueDate = assertDateString(input.issueDate, "issueDate");
  const dueDate = assertDateString(input.dueDate, "dueDate");
  if (dueDate < issueDate) {
    throw new DomainError(
      "DUE_BEFORE_ISSUE",
      `dueDate ${dueDate} is before issueDate ${issueDate}`,
    );
  }
  const invoiceId = newId();
  const at = nowOf(actor);
  const { value, replayed } = await store.transact(
    businessId,
    {
      idempotencyKey: scopedIdempotencyKey(
        "quote-convert",
        input.idempotencyKey,
      ),
    },
    async (tx) => {
      const quote = await tx.getQuote(businessId, quoteId);
      if (!quote) {
        throw new DomainError("NOT_FOUND", `quote ${quoteId} not found`);
      }
      if (quote.status === "converted" && quote.convertedInvoiceId) {
        const existing = await tx.getInvoice(
          businessId,
          quote.convertedInvoiceId,
        );
        if (existing) {
          return { batch: { puts: [], audits: [] }, value: { invoice: existing, quote } };
        }
      }
      if (quote.status !== "sent" && quote.status !== "accepted") {
        throw new DomainError(
          "INVALID_STATUS_TRANSITION",
          `quote ${quoteId} is ${quote.status}; only sent/accepted quotes can be converted`,
        );
      }
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(issueDate, periods);

      const business = await tx.getBusiness(businessId);
      if (!business) {
        throw new DomainError(
          "NOT_FOUND",
          `business ${businessId} not found`,
        );
      }
      const seq = (business.invoiceCounter ?? 0) + 1;

      const invoice: Invoice = {
        id: invoiceId,
        invoiceNumber: formatInvoiceNumber(seq),
        customerId: quote.customerId,
        projectId: quote.projectId,
        issueDate,
        dueDate,
        items: quote.items,
        totalAmount: quote.totalAmount,
        taxAmount: quote.taxAmount,
        status: "draft",
        quoteId: quote.id,
        createdAt: at,
        updatedAt: at,
      };
      const quoteNext: Quote = {
        ...quote,
        status: "converted",
        convertedInvoiceId: invoiceId,
        updatedAt: at,
      };
      return {
        batch: {
          puts: [
            { collection: "invoices", id: invoiceId, data: invoice },
            { collection: "quotes", id: quoteId, data: quoteNext },
            {
              collection: "businesses",
              id: businessId,
              data: { ...business, invoiceCounter: seq, updatedAt: at },
            },
          ],
          audits: [
            ...auditsFor(
              businessId,
              [{ collection: "invoices", id: invoiceId }],
              "create",
              actor,
            ),
            ...auditsFor(
              businessId,
              [{ collection: "quotes", id: quoteId }],
              "update",
              actor,
            ),
          ],
        },
        value: { invoice, quote: quoteNext },
      };
    },
  );
  return { ...value, replayed };
}
