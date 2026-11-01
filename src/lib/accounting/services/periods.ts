import {
  assertDateString,
  fiscalPeriodOf,
  isWithinPeriod,
} from "../dates";
import { DomainError } from "../errors";
import type { AccountingStore } from "../store/types";
import type { FiscalPeriod, Transaction } from "../types";
import { auditsFor, nowOf, type ActorContext } from "./common";
import type { UnpaidExpense } from "./expenses";
import { findUnpaidExpenses } from "./expenses";
import { findUnpaidInvoices, type UnpaidInvoice } from "./sales";

export function fiscalPeriodIdOf(
  date: string,
  startMonth: number,
): { id: string; bounds: ReturnType<typeof fiscalPeriodOf> } {
  const bounds = fiscalPeriodOf(assertDateString(date), startMonth);
  return { id: `fy${bounds.fiscalYear}`, bounds };
}

/**
 * date を含む会計期間が無ければ open で作成する。
 * periodId は fy{fiscalYear} で決定的なので自然に冪等。
 * 既存期間と範囲がずれて重複する場合は PERIOD_OVERLAP。
 */
export async function ensureFiscalPeriodForDate(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  date: string,
): Promise<{ period: FiscalPeriod; created: boolean }> {
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const business = await tx.getBusiness(businessId);
    if (!business) {
      throw new DomainError(
        "NOT_FOUND",
        `business ${businessId} not found`,
      );
    }
    const { id, bounds } = fiscalPeriodIdOf(
      date,
      business.fiscalYearStartMonth,
    );
    const existing = await tx.getFiscalPeriod(businessId, id);
    if (existing) {
      return { batch: { puts: [], audits: [] }, value: { period: existing, created: false } };
    }
    const periods = await tx.listFiscalPeriods(businessId);
    for (const p of periods) {
      const overlap =
        bounds.startDate <= p.endDate && p.startDate <= bounds.endDate;
      if (overlap) {
        throw new DomainError(
          "PERIOD_OVERLAP",
          `fiscal period ${id} overlaps with existing ${p.id}`,
          { existing: p.id },
        );
      }
    }
    const period: FiscalPeriod = {
      id,
      fiscalYear: bounds.fiscalYear,
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      status: "open",
    };
    return {
      batch: {
        puts: [{ collection: "fiscalPeriods", id, data: period }],
        audits: auditsFor(
          businessId,
          [{ collection: "fiscalPeriods", id }],
          "create",
          actor,
        ),
      },
      value: { period, created: true },
    };
  });
  return value;
}

export interface ClosingChecklist {
  period: FiscalPeriod;
  /** 証憑未添付の確定済み経費取引 */
  missingReceiptTransactions: Transaction[];
  /** 未処理の証憑 */
  unprocessedReceiptIds: string[];
  /** 未払経費(期間内の取引に紐付くもの) */
  unpaidExpenses: UnpaidExpense[];
  /** 未入金請求書(期日が期間内または経過したもの) */
  unpaidInvoices: UnpaidInvoice[];
  /** 期間内のdraft取引。残っていると締められない */
  draftTransactions: Transaction[];
  /** draft取引が無ければ true */
  canClose: boolean;
}

/**
 * 締めチェックリスト(F4)。
 * 証憑未添付・未払経費・未入金売上を可視化する。
 */
export async function closingChecklist(
  store: AccountingStore,
  businessId: string,
  periodId: string,
  asOf: string,
): Promise<ClosingChecklist> {
  const asOfDate = assertDateString(asOf, "asOf");
  const period = await store.getFiscalPeriod(businessId, periodId);
  if (!period) {
    throw new DomainError("NOT_FOUND", `fiscal period ${periodId} not found`);
  }
  const transactions = await store.listTransactionsInRange(
    businessId,
    period.startDate,
    period.endDate,
  );
  const draftTransactions = transactions.filter((t) => t.status === "draft");
  const missingReceiptTransactions = transactions.filter(
    (t) =>
      t.status !== "draft" &&
      t.type === "expense" &&
      t.receiptIds.length === 0,
  );
  const unprocessed = await store.listReceipts(businessId, "unprocessed");

  const txById = new Map(transactions.map((t) => [t.id, t]));
  const unpaidExpenses = (await findUnpaidExpenses(store, businessId, asOfDate))
    .filter((u) => {
      const t = u.transaction ?? txById.get(u.expense.transactionId);
      return (
        t !== undefined &&
        isWithinPeriod(t.date, period.startDate, period.endDate)
      );
    });

  const unpaidInvoices = (await findUnpaidInvoices(store, businessId, asOfDate))
    .filter(
      (u) =>
        isWithinPeriod(u.invoice.issueDate, period.startDate, period.endDate) ||
        u.invoice.dueDate <= period.endDate,
    );

  return {
    period,
    missingReceiptTransactions,
    unprocessedReceiptIds: unprocessed.map((r) => r.id),
    unpaidExpenses,
    unpaidInvoices,
    draftTransactions,
    canClose: draftTransactions.length === 0,
  };
}

/**
 * 会計期間を締める。
 * - 期間内にdraft取引が残っている場合は拒否する(確定 or 削除が先)
 * - 期間内のconfirmed取引をすべて locked にする
 * - 締め後はその期間の日付を持つデータの変更が拒否される
 * idempotencyKey により締め処理の再実行は安全。
 */
export async function closeFiscalPeriod(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  periodId: string,
  idempotencyKey: string,
): Promise<{ period: FiscalPeriod; lockedTransactions: number; replayed: boolean }> {
  const at = nowOf(actor);
  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey },
    async (tx) => {
      const period = await tx.getFiscalPeriod(businessId, periodId);
      if (!period) {
        throw new DomainError(
          "NOT_FOUND",
          `fiscal period ${periodId} not found`,
        );
      }
      if (period.status === "closed") {
        throw new DomainError(
          "PERIOD_NOT_OPEN",
          `fiscal period ${periodId} is already closed`,
        );
      }
      const transactions = await tx.listTransactionsInRange(
        businessId,
        period.startDate,
        period.endDate,
      );
      const drafts = transactions.filter((t) => t.status === "draft");
      if (drafts.length > 0) {
        throw new DomainError(
          "HAS_DRAFT_TRANSACTIONS",
          `fiscal period ${periodId} has ${drafts.length} draft transactions`,
          { draftIds: drafts.map((t) => t.id) },
        );
      }

      const puts: { collection: "transactions" | "fiscalPeriods"; id: string; data: unknown }[] = [];
      const auditTargets: { collection: "transactions" | "fiscalPeriods"; id: string }[] = [];

      const closedPeriod: FiscalPeriod = {
        ...period,
        status: "closed",
        closedAt: at,
        closedBy: actor.uid,
      };
      puts.push({ collection: "fiscalPeriods", id: periodId, data: closedPeriod });
      auditTargets.push({ collection: "fiscalPeriods", id: periodId });

      for (const t of transactions) {
        if (t.status !== "confirmed") continue;
        const locked: Transaction = { ...t, status: "locked", updatedAt: at };
        puts.push({ collection: "transactions", id: t.id, data: locked });
        auditTargets.push({ collection: "transactions", id: t.id });
      }

      const audits = [
        ...auditsFor(
          businessId,
          [{ collection: "fiscalPeriods", id: periodId }],
          "close",
          actor,
        ),
        ...auditsFor(
          businessId,
          auditTargets.filter((t) => t.collection === "transactions"),
          "update",
          actor,
        ),
      ];
      return {
        batch: { puts, audits },
        value: {
          period: closedPeriod,
          lockedTransactions: auditTargets.length - 1,
        },
      };
    },
  );
  return { ...value, replayed };
}
