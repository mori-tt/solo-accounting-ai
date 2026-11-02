import {
  assertDateString,
  fiscalPeriodOf,
  isWithinPeriod,
} from "../dates";
import {
  buildJournal,
  computeCarryForwardBalances,
  type CarryForwardBalance,
} from "../domain/ledger";
import { DomainError } from "../errors";
import type { AccountingReader, AccountingStore } from "../store/types";
import type {
  Business,
  FiscalPeriod,
  OpeningBalance,
  Transaction,
} from "../types";
import { auditsFor, nowOf, type ActorContext } from "./common";
import type { UnpaidExpense } from "./expenses";
import { findUnpaidExpenses } from "./expenses";
import { findUnpaidInvoices, type UnpaidInvoice } from "./sales";
import { OPENING_BALANCE_ACCOUNT_OPTIONS } from "@/lib/opening-balance-accounts";

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

/** 締めと同時に翌年度へ繰り越せる期首残高のプレビュー */
export interface CarryForwardPreview {
  /** 繰越先の会計年度 */
  nextFiscalYear: number;
  /** 対象科目ごとの期末残高(0・マイナスも含む・科目コード昇順) */
  balances: CarryForwardBalance[];
  /** 翌年度に登録済みの期首残高(繰越実行時に対象科目は上書きされる) */
  existing: OpeningBalance[];
  /**
   * 翌年度の会計期間が既に締め済みなら true。
   * この場合、繰越を選択しても締め実行時に生成がスキップされる
   * (締め済み年度の期首残高は変更不可)。
   */
  nextYearClosed: boolean;
}

interface CarryForwardComputation extends CarryForwardPreview {
  /** 繰越対象の科目コード集合(翌年度レコードの置き換え範囲) */
  targets: ReadonlySet<string>;
}

/**
 * 繰越残高の計算。締めチェックのプレビューと締め実行で共通利用する。
 * 対象科目 = 期首残高のプリセット資産科目(現金・預金・売掛金)
 *   + 期首残高に登録済みの科目(年度を問わず)。
 * 翌年度に登録済みの科目も対象に含まれるため、繰越実行時には
 * 手入力の翌年度残高も期末残高の計算値で置き換わる(確認UIで警告)。
 * 残高は全期間の確定済み取引と期首残高設定から ledger 計算で求める
 * (domain/ledger.ts の computeCarryForwardBalances)。
 */
async function computeCarryForward(
  reader: AccountingReader,
  businessId: string,
  business: Business,
  period: FiscalPeriod,
): Promise<CarryForwardComputation> {
  const nextFiscalYear = period.fiscalYear + 1;
  const registered = business.openingBalances ?? [];
  const targets = new Set(
    OPENING_BALANCE_ACCOUNT_OPTIONS.map((o) => o.code),
  );
  for (const b of registered) {
    if (b.accountCode !== "") targets.add(b.accountCode);
  }
  const [transactions, nextPeriod] = await Promise.all([
    reader.listTransactionsInRange(businessId, "0001-01-01", period.endDate),
    reader.getFiscalPeriod(businessId, `fy${nextFiscalYear}`),
  ]);
  return {
    nextFiscalYear,
    nextYearClosed: nextPeriod?.status === "closed",
    targets,
    balances: computeCarryForwardBalances(
      buildJournal(transactions),
      registered,
      period.fiscalYear,
      business.fiscalYearStartMonth,
      [...targets],
    ),
    existing: registered.filter((b) => b.fiscalYear === nextFiscalYear),
  };
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
  /** 翌年度への繰越プレビュー。締め済み期間では undefined */
  carryForward?: CarryForwardPreview;
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
  const business = await store.getBusiness(businessId);
  if (!business) {
    throw new DomainError("NOT_FOUND", `business ${businessId} not found`);
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

  const carryForward =
    period.status === "open"
      ? await computeCarryForward(store, businessId, business, period)
      : undefined;

  return {
    period,
    missingReceiptTransactions,
    unprocessedReceiptIds: unprocessed.map((r) => r.id),
    unpaidExpenses,
    unpaidInvoices,
    draftTransactions,
    canClose: draftTransactions.length === 0,
    carryForward,
  };
}

/** closeFiscalPeriod の結果に含める繰越情報 */
export interface CarriedForwardResult {
  /** 繰越先の会計年度 */
  fiscalYear: number;
  /** 実際に生成した期首残高(残高0の科目は除く・科目コード昇順) */
  balances: OpeningBalance[];
  /**
   * 翌年度の会計期間が既に締め済みのため生成をスキップした場合 true。
   * 締め済み年度の期首残高は変更不可ルールに従う。
   */
  skippedClosedYear?: boolean;
}

/**
 * 会計期間を締める。
 * - 期間内にdraft取引が残っている場合は拒否する(確定 or 削除が先)
 * - 期間内のconfirmed取引をすべて locked にする
 * - 締め後はその期間の日付を持つデータの変更が拒否される
 * - options.carryForward 指定時は翌年度の期首残高を同じトランザクションで
 *   自動生成する(対象科目は計算値で上書き・対象外の翌年度レコードは保持)
 * idempotencyKey により締め処理の再実行は安全。
 */
export async function closeFiscalPeriod(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  periodId: string,
  idempotencyKey: string,
  options: { carryForward?: boolean } = {},
): Promise<{
  period: FiscalPeriod;
  lockedTransactions: number;
  carriedForward: CarriedForwardResult | null;
  replayed: boolean;
}> {
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

      const puts: { collection: "transactions" | "fiscalPeriods" | "businesses"; id: string; data: unknown }[] = [];
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

      let carriedForward: CarriedForwardResult | null = null;
      let businessUpdated = false;
      if (options.carryForward === true) {
        const business = await tx.getBusiness(businessId);
        if (!business) {
          throw new DomainError(
            "NOT_FOUND",
            `business ${businessId} not found`,
          );
        }
        const cf = await computeCarryForward(tx, businessId, business, period);
        // 翌年度が既に締め済みなら、その年度の期首残高は変更できないため
        // 生成をスキップする(締め済み期間の直接変更禁止)
        if (cf.nextYearClosed) {
          carriedForward = {
            fiscalYear: cf.nextFiscalYear,
            balances: [],
            skippedClosedYear: true,
          };
        } else {
          const generated: OpeningBalance[] = cf.balances
            .filter((b) => b.amount !== 0)
            .map((b) => ({
              fiscalYear: cf.nextFiscalYear,
              accountCode: b.accountCode,
              amount: b.amount,
            }));
          // 翌年度レコードのうち対象科目は計算値で置き換え、対象外は保持する
          const kept = (business.openingBalances ?? []).filter(
            (b) =>
              b.fiscalYear !== cf.nextFiscalYear ||
              !cf.targets.has(b.accountCode),
          );
          const removed =
            (business.openingBalances ?? []).length - kept.length;
          if (generated.length > 0 || removed > 0) {
            const next: Business = {
              ...business,
              openingBalances: [...kept, ...generated],
              updatedAt: at,
            };
            puts.push({
              collection: "businesses",
              id: businessId,
              data: next,
            });
            businessUpdated = true;
          }
          carriedForward = {
            fiscalYear: cf.nextFiscalYear,
            balances: generated,
          };
        }
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
        ...(businessUpdated
          ? auditsFor(
              businessId,
              [{ collection: "businesses", id: businessId }],
              "update",
              actor,
            )
          : []),
      ];
      return {
        batch: { puts, audits },
        value: {
          period: closedPeriod,
          lockedTransactions: auditTargets.length - 1,
          carriedForward,
        },
      };
    },
  );
  return { ...value, replayed };
}
