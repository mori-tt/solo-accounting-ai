import {
  addDays,
  formatDate,
  isValidMonthKey,
  lastDayOfMonth,
  parseDate,
} from "../dates";
import { DomainError } from "../errors";
import { computeInvoiceTotals } from "../invoice-tax";
import type { AccountingStore, PutOp } from "../store/types";
import type {
  Business,
  Invoice,
  InvoiceItem,
  RecurringInvoiceTemplate,
} from "../types";
import {
  assertDateInOpenPeriod,
  auditsFor,
  newId,
  nowOf,
  scopedIdempotencyKey,
  type ActorContext,
} from "./common";
import { formatInvoiceNumber, normalizeInvoiceItems } from "./sales";

const MAX_INTERVAL_MONTHS = 36;
const MAX_DUE_DAYS = 366;
const MAX_OCCURRENCES = 999;

export interface RecurringInvoiceTemplateFields {
  name: string;
  customerId: string;
  projectId?: string;
  /** 明細(数量・単価・税率)。amount/taxAmountは登録時に正規化する */
  items: InvoiceItem[];
  /** 生成間隔(月・1-36)。startDateの月が起点 */
  intervalMonths: number;
  /** 毎月の発行日(1-31)。その月に存在しない日は末日へ調整する */
  dayOfMonth: number;
  /** この日以降の発行日のみ生成する開始日 YYYY-MM-DD */
  startDate: string;
  /** この日を超える発行日は生成しない終了日 YYYY-MM-DD(任意) */
  endDate?: string;
  /** 生成する請求書の上限回数(任意) */
  maxOccurrences?: number;
  /** 支払期日 = 発行日 + dueDays 日後 */
  dueDays: number;
}

function assertTemplateFields(input: RecurringInvoiceTemplateFields): {
  items: InvoiceItem[];
} {
  if (!input.name) {
    throw new DomainError("INVALID_INPUT", "name is required");
  }
  if (!input.customerId) {
    throw new DomainError("INVALID_INPUT", "customerId is required");
  }
  const { items } = normalizeInvoiceItems(input.items);
  if (
    !Number.isInteger(input.intervalMonths) ||
    input.intervalMonths < 1 ||
    input.intervalMonths > MAX_INTERVAL_MONTHS
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      `intervalMonths must be an integer between 1 and ${MAX_INTERVAL_MONTHS}`,
    );
  }
  if (
    !Number.isInteger(input.dayOfMonth) ||
    input.dayOfMonth < 1 ||
    input.dayOfMonth > 31
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "dayOfMonth must be an integer between 1 and 31",
    );
  }
  parseDate(input.startDate, "startDate");
  if (input.endDate !== undefined) {
    parseDate(input.endDate, "endDate");
    if (input.endDate < input.startDate) {
      throw new DomainError(
        "INVALID_INPUT",
        `endDate ${input.endDate} is before startDate ${input.startDate}`,
      );
    }
  }
  if (
    input.maxOccurrences !== undefined &&
    (!Number.isInteger(input.maxOccurrences) ||
      input.maxOccurrences < 1 ||
      input.maxOccurrences > MAX_OCCURRENCES)
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      `maxOccurrences must be an integer between 1 and ${MAX_OCCURRENCES}`,
    );
  }
  if (
    !Number.isInteger(input.dueDays) ||
    input.dueDays < 0 ||
    input.dueDays > MAX_DUE_DAYS
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      `dueDays must be an integer between 0 and ${MAX_DUE_DAYS}`,
    );
  }
  return { items };
}

export interface RegisterRecurringInvoiceTemplateInput
  extends RecurringInvoiceTemplateFields {
  id?: string;
  /** リトライ安全のため必須。同じキーでの再実行は既存結果を返す */
  idempotencyKey: string;
}

/** 定期請求書テンプレートを active で登録する。明細は正規化して保持する。 */
export async function registerRecurringInvoiceTemplate(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterRecurringInvoiceTemplateInput,
): Promise<{ template: RecurringInvoiceTemplate; replayed: boolean }> {
  const { items } = assertTemplateFields(input);
  const id = input.id ?? newId();
  const at = nowOf(actor);
  const { value, replayed } = await store.transact(
    businessId,
    {
      idempotencyKey: scopedIdempotencyKey(
        "recurringInvoiceTemplate",
        input.idempotencyKey,
      ),
    },
    async (tx) => {
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
      const template: RecurringInvoiceTemplate = {
        id,
        name: input.name,
        customerId: input.customerId,
        projectId: input.projectId,
        items,
        intervalMonths: input.intervalMonths,
        dayOfMonth: input.dayOfMonth,
        startDate: input.startDate,
        endDate: input.endDate,
        maxOccurrences: input.maxOccurrences,
        dueDays: input.dueDays,
        active: true,
        generatedCount: 0,
        createdBy: actor.uid,
        createdAt: at,
        updatedAt: at,
      };
      return {
        batch: {
          puts: [
            { collection: "recurringInvoiceTemplates", id, data: template },
          ],
          audits: auditsFor(
            businessId,
            [{ collection: "recurringInvoiceTemplates", id }],
            "create",
            actor,
          ),
        },
        value: template,
      };
    },
  );
  return { template: value, replayed };
}

export interface UpdateRecurringInvoiceTemplateInput
  extends RecurringInvoiceTemplateFields {
  active: boolean;
}

/** テンプレート内容の更新。createdBy/createdAt/generatedCount は維持する。 */
export async function updateRecurringInvoiceTemplate(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  templateId: string,
  input: UpdateRecurringInvoiceTemplateInput,
): Promise<{ template: RecurringInvoiceTemplate }> {
  const { items } = assertTemplateFields(input);
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getRecurringInvoiceTemplate(
      businessId,
      templateId,
    );
    if (!current) {
      throw new DomainError(
        "NOT_FOUND",
        `recurringInvoiceTemplate ${templateId} not found`,
      );
    }
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
    const next: RecurringInvoiceTemplate = {
      ...current,
      name: input.name,
      customerId: input.customerId,
      projectId: input.projectId,
      items,
      intervalMonths: input.intervalMonths,
      dayOfMonth: input.dayOfMonth,
      startDate: input.startDate,
      endDate: input.endDate,
      maxOccurrences: input.maxOccurrences,
      dueDays: input.dueDays,
      active: input.active,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [
          {
            collection: "recurringInvoiceTemplates",
            id: templateId,
            data: next,
          },
        ],
        audits: auditsFor(
          businessId,
          [{ collection: "recurringInvoiceTemplates", id: templateId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { template: value };
}

/** テンプレートの有効/無効を切り替える(無効化は削除ではなくactive=false)。 */
export async function setRecurringInvoiceTemplateActive(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  templateId: string,
  active: boolean,
): Promise<{ template: RecurringInvoiceTemplate }> {
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getRecurringInvoiceTemplate(
      businessId,
      templateId,
    );
    if (!current) {
      throw new DomainError(
        "NOT_FOUND",
        `recurringInvoiceTemplate ${templateId} not found`,
      );
    }
    if (current.active === active) {
      return { batch: { puts: [], audits: [] }, value: current };
    }
    const next: RecurringInvoiceTemplate = {
      ...current,
      active,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [
          {
            collection: "recurringInvoiceTemplates",
            id: templateId,
            data: next,
          },
        ],
        audits: auditsFor(
          businessId,
          [{ collection: "recurringInvoiceTemplates", id: templateId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { template: value };
}

/** 生成される請求書のドキュメントID(月・テンプレートごとに決定的=二重生成防止) */
function generatedInvoiceId(templateId: string, monthKey: string): string {
  return `recurring-invoice-${templateId}-${monthKey}`;
}

/** (year, month) を通算の月インデックスへ変換する(間隔計算用)。 */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

/**
 * 指定月(yyyyMM)分の請求書を、未処理の active テンプレート分だけ一括生成する。
 * 生成される請求書は draft で、番号は既存の請求書連番(invoiceCounter)を使う。
 * スケジュール判定:
 * - startDate の月を起点に intervalMonths ごとの月のみ対象
 * - 発行日が startDate 未満・endDate 超過・maxOccurrences 到達済みなら生成しない
 * 定期取引と同様に lastGeneratedMonth で生成済みを管理し、
 * 同じ月の再実行は重複作成しない(冪等)。
 */
export async function generateRecurringInvoices(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  monthKey: string,
): Promise<{ invoices: Invoice[] }> {
  if (!isValidMonthKey(monthKey)) {
    throw new DomainError("INVALID_DATE", `invalid month key: ${monthKey}`);
  }
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(4, 6));
  const lastDay = lastDayOfMonth(year, month);
  const targetIndex = monthIndex(year, month);

  const { value } = await store.transact(businessId, {}, async (tx) => {
    const templates = await tx.listRecurringInvoiceTemplates(businessId);
    const targets = templates.filter(
      (t) => t.active && t.lastGeneratedMonth !== monthKey,
    );
    if (targets.length === 0) {
      return { batch: { puts: [], audits: [] }, value: [] };
    }

    const periods = await tx.listFiscalPeriods(businessId);
    const at = nowOf(actor);
    const puts: PutOp[] = [];
    const created: Invoice[] = [];
    let business: Business | undefined;
    let seqBase = 0;

    for (const template of targets) {
      // dayOfMonth がその月の日数を超える場合は月末へ調整する
      const issueDate = formatDate({
        year,
        month,
        day: Math.min(template.dayOfMonth, lastDay),
      });
      const start = parseDate(template.startDate, "startDate");
      const startIndex = monthIndex(start.year, start.month);
      // startDate の月を起点に intervalMonths ごとの月のみ生成
      const due =
        targetIndex >= startIndex &&
        (targetIndex - startIndex) % template.intervalMonths === 0 &&
        issueDate >= template.startDate &&
        (template.endDate === undefined || issueDate <= template.endDate) &&
        (template.maxOccurrences === undefined ||
          template.generatedCount < template.maxOccurrences);

      let invoiceCreated = false;
      if (due) {
        assertDateInOpenPeriod(issueDate, periods);
        const invoiceId = generatedInvoiceId(template.id, monthKey);
        const existing = await tx.getInvoice(businessId, invoiceId);
        if (!existing) {
          // 請求書番号は事業ドキュメントのカウンタから連番採番する。
          // 複数テンプレート分を同一バッチで発行するためカウンタは
          // ループ内で進め、最後にまとめて書き戻す(registerInvoiceと同じ仕組み)
          if (!business) {
            business = await tx.getBusiness(businessId);
            if (!business) {
              throw new DomainError(
                "NOT_FOUND",
                `business ${businessId} not found`,
              );
            }
            seqBase = business.invoiceCounter ?? 0;
          }
          seqBase += 1;
          const totals = computeInvoiceTotals(template.items);
          const invoice: Invoice = {
            id: invoiceId,
            invoiceNumber: formatInvoiceNumber(seqBase),
            customerId: template.customerId,
            projectId: template.projectId,
            issueDate,
            dueDate: addDays(issueDate, template.dueDays),
            items: template.items,
            totalAmount: totals.totalAmount,
            taxAmount: totals.taxAmount,
            status: "draft",
            createdAt: at,
            updatedAt: at,
          };
          created.push(invoice);
          puts.push({
            collection: "invoices",
            id: invoiceId,
            data: invoice,
          });
          invoiceCreated = true;
        }
      }

      // 生成済み・期間外・上限到達のいずれの場合も lastGeneratedMonth は進める
      const templateNext: RecurringInvoiceTemplate = {
        ...template,
        generatedCount: template.generatedCount + (invoiceCreated ? 1 : 0),
        lastGeneratedMonth: monthKey,
        updatedAt: at,
      };
      puts.push({
        collection: "recurringInvoiceTemplates",
        id: template.id,
        data: templateNext,
      });
    }

    if (business) {
      puts.push({
        collection: "businesses",
        id: businessId,
        data: { ...business, invoiceCounter: seqBase, updatedAt: at },
      });
    }

    return {
      batch: {
        puts,
        audits: [
          ...auditsFor(
            businessId,
            created.map((i) => ({ collection: "invoices", id: i.id })),
            "create",
            actor,
          ),
          ...auditsFor(
            businessId,
            targets.map((t) => ({
              collection: "recurringInvoiceTemplates",
              id: t.id,
            })),
            "update",
            actor,
          ),
        ],
      },
      value: created,
    };
  });
  return { invoices: value };
}
