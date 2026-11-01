import {
  formatDate,
  isValidMonthKey,
  lastDayOfMonth,
} from "../dates";
import { DomainError } from "../errors";
import { assertYenAmount } from "../money";
import type { AccountingStore, PutOp } from "../store/types";
import type {
  RecurringTemplate,
  Transaction,
  TransactionType,
} from "../types";
import {
  assertDateInOpenPeriod,
  auditsFor,
  newId,
  nowOf,
  type ActorContext,
} from "./common";

const TRANSACTION_TYPES: readonly TransactionType[] = [
  "income",
  "expense",
  "transfer",
];

export interface RecurringTemplateFields {
  name: string;
  type: TransactionType;
  /** 勘定科目コード */
  account: string;
  counterparty?: string;
  description?: string;
  /** 円・整数・正数 */
  amount: number;
  /** 毎月の生成日(1-31)。その月に存在しない日は末日へ調整する */
  dayOfMonth: number;
}

function assertTemplateFields(input: RecurringTemplateFields): void {
  if (!input.name) {
    throw new DomainError("INVALID_INPUT", "name is required");
  }
  if (!TRANSACTION_TYPES.includes(input.type)) {
    throw new DomainError(
      "INVALID_INPUT",
      `invalid transaction type: ${String(input.type)}`,
    );
  }
  if (!input.account) {
    throw new DomainError("INVALID_INPUT", "account is required");
  }
  assertYenAmount(input.amount);
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
}

export interface RegisterRecurringTemplateInput
  extends RecurringTemplateFields {
  id?: string;
  /** リトライ安全のため必須。同じキーでの再実行は既存結果を返す */
  idempotencyKey: string;
}

/** 定期取引テンプレートを active で登録する。 */
export async function registerRecurringTemplate(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterRecurringTemplateInput,
): Promise<{ template: RecurringTemplate; replayed: boolean }> {
  assertTemplateFields(input);
  const id = input.id ?? newId();
  const at = nowOf(actor);
  const template: RecurringTemplate = {
    id,
    name: input.name,
    type: input.type,
    account: input.account,
    counterparty: input.counterparty ?? "",
    description: input.description ?? "",
    amount: input.amount,
    dayOfMonth: input.dayOfMonth,
    active: true,
    createdBy: actor.uid,
    createdAt: at,
    updatedAt: at,
  };
  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: input.idempotencyKey },
    async () => ({
      batch: {
        puts: [{ collection: "recurringTemplates", id, data: template }],
        audits: auditsFor(
          businessId,
          [{ collection: "recurringTemplates", id }],
          "create",
          actor,
        ),
      },
      value: template,
    }),
  );
  return { template: value, replayed };
}

export interface UpdateRecurringTemplateInput
  extends RecurringTemplateFields {
  active: boolean;
}

/** テンプレート内容の更新。createdBy/createdAt は維持する。 */
export async function updateRecurringTemplate(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  templateId: string,
  input: UpdateRecurringTemplateInput,
): Promise<{ template: RecurringTemplate }> {
  assertTemplateFields(input);
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getRecurringTemplate(businessId, templateId);
    if (!current) {
      throw new DomainError(
        "NOT_FOUND",
        `recurringTemplate ${templateId} not found`,
      );
    }
    const next: RecurringTemplate = {
      ...current,
      name: input.name,
      type: input.type,
      account: input.account,
      counterparty: input.counterparty ?? "",
      description: input.description ?? "",
      amount: input.amount,
      dayOfMonth: input.dayOfMonth,
      active: input.active,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [
          { collection: "recurringTemplates", id: templateId, data: next },
        ],
        audits: auditsFor(
          businessId,
          [{ collection: "recurringTemplates", id: templateId }],
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
export async function setRecurringTemplateActive(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  templateId: string,
  active: boolean,
): Promise<{ template: RecurringTemplate }> {
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getRecurringTemplate(businessId, templateId);
    if (!current) {
      throw new DomainError(
        "NOT_FOUND",
        `recurringTemplate ${templateId} not found`,
      );
    }
    if (current.active === active) {
      return { batch: { puts: [], audits: [] }, value: current };
    }
    const next: RecurringTemplate = {
      ...current,
      active,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [
          { collection: "recurringTemplates", id: templateId, data: next },
        ],
        audits: auditsFor(
          businessId,
          [{ collection: "recurringTemplates", id: templateId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { template: value };
}

/** 生成される取引のドキュメントID(月・テンプレートごとに決定的=二重生成防止) */
function generatedTransactionId(
  templateId: string,
  monthKey: string,
): string {
  return `recurring-${templateId}-${monthKey}`;
}

/**
 * 指定月(yyyyMM)分の取引を、未生成の active テンプレート分だけ一括生成する。
 * 生成した取引は draft。テンプレートの lastGeneratedMonth で生成済みを管理し、
 * 再実行しても同じ月の取引は重複作成しない(冪等)。
 */
export async function generateRecurringTransactions(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  monthKey: string,
): Promise<{ transactions: Transaction[] }> {
  if (!isValidMonthKey(monthKey)) {
    throw new DomainError(
      "INVALID_DATE",
      `invalid month key: ${monthKey}`,
    );
  }
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(4, 6));
  const lastDay = lastDayOfMonth(year, month);

  const { value } = await store.transact(businessId, {}, async (tx) => {
    const templates = await tx.listRecurringTemplates(businessId);
    const targets = templates.filter(
      (t) => t.active && t.lastGeneratedMonth !== monthKey,
    );
    if (targets.length === 0) {
      return { batch: { puts: [], audits: [] }, value: [] };
    }

    const periods = await tx.listFiscalPeriods(businessId);
    const at = nowOf(actor);
    const puts: PutOp[] = [];
    const created: Transaction[] = [];

    for (const template of targets) {
      // dayOfMonth がその月の日数を超える場合は月末へ調整する
      const date = formatDate({
        year,
        month,
        day: Math.min(template.dayOfMonth, lastDay),
      });
      assertDateInOpenPeriod(date, periods);

      const transactionId = generatedTransactionId(template.id, monthKey);
      const existing = await tx.getTransaction(businessId, transactionId);
      if (!existing) {
        const transaction: Transaction = {
          id: transactionId,
          type: template.type,
          date,
          amount: template.amount,
          account: template.account,
          counterparty: template.counterparty,
          description: template.description,
          receiptIds: [],
          status: "draft",
          createdBy: actor.uid,
          createdAt: at,
          updatedAt: at,
        };
        created.push(transaction);
        puts.push({
          collection: "transactions",
          id: transactionId,
          data: transaction,
        });
      }
      // 生成済み取引が残っている場合も lastGeneratedMonth だけは進める
      const templateNext: RecurringTemplate = {
        ...template,
        lastGeneratedMonth: monthKey,
        updatedAt: at,
      };
      puts.push({
        collection: "recurringTemplates",
        id: template.id,
        data: templateNext,
      });
    }

    return {
      batch: {
        puts,
        audits: [
          ...auditsFor(
            businessId,
            created.map((t) => ({
              collection: "transactions",
              id: t.id,
            })),
            "create",
            actor,
          ),
          ...auditsFor(
            businessId,
            targets.map((t) => ({
              collection: "recurringTemplates",
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
  return { transactions: value };
}
