import { isValidMonthKey, monthKeyOf, monthKeyRange } from "../dates";
import { DomainError } from "../errors";
import type { AccountingStore } from "../store/types";
import type { MonthlySummary, Transaction } from "../types";
import { auditsFor, nowOf, type ActorContext } from "./common";

/**
 * 月次集計の計算(純粋関数)。
 * draft は未確定の入力途中データなので集計対象外。
 * confirmed と locked(締め済み期間)のみを含める。
 */
export function computeMonthlySummary(
  monthKey: string,
  transactions: readonly Transaction[],
  computedAt: string,
): MonthlySummary {
  if (!isValidMonthKey(monthKey)) {
    throw new DomainError("INVALID_DATE", `invalid month key: ${monthKey}`);
  }
  let totalIncome = 0;
  let totalExpense = 0;
  const accountBreakdown: Record<
    string,
    { income: number; expense: number }
  > = {};

  for (const t of transactions) {
    if (t.status === "draft") continue;
    if (monthKeyOf(t.date) !== monthKey) continue;
    const entry = (accountBreakdown[t.account] ??= { income: 0, expense: 0 });
    if (t.type === "income") {
      totalIncome += t.amount;
      entry.income += t.amount;
    } else if (t.type === "expense") {
      totalExpense += t.amount;
      entry.expense += t.amount;
    }
  }
  return { month: monthKey, totalIncome, totalExpense, accountBreakdown, computedAt };
}

/**
 * monthlySummaries/{yyyyMM} を再計算して保存する。
 * 手計算値の保存は禁止(ACCOUNTING_RULES.md)。必ずTransactionから再計算する。
 * 何度実行しても同じ結果になる(derived data)。
 */
export async function recomputeMonthlySummary(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  monthKey: string,
): Promise<{ summary: MonthlySummary }> {
  const { startDate, endDate } = monthKeyRange(monthKey);
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const transactions = await tx.listTransactionsInRange(
      businessId,
      startDate,
      endDate,
    );
    const summary = computeMonthlySummary(
      monthKey,
      transactions,
      nowOf(actor),
    );
    return {
      batch: {
        puts: [
          { collection: "monthlySummaries", id: monthKey, data: summary },
        ],
        audits: auditsFor(
          businessId,
          [{ collection: "monthlySummaries", id: monthKey }],
          "update",
          actor,
        ),
      },
      value: summary,
    };
  });
  return { summary: value };
}
