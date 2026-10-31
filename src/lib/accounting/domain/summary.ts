import { assertYearMonth, yearMonthOf, type YearMonth } from "./dates";
import { addYen } from "./money";
import type {
  AccountBreakdownEntry,
  MonthlySummaryEntity,
  TransactionEntity,
} from "./types";

export function computeMonthlySummary(
  yearMonth: YearMonth,
  transactions: readonly TransactionEntity[],
  computedAt: Date,
): MonthlySummaryEntity {
  assertYearMonth(yearMonth, "yearMonth");

  let totalIncome = 0;
  let totalExpense = 0;
  let transactionCount = 0;
  const accountBreakdown: Record<string, AccountBreakdownEntry> = {};

  for (const transaction of transactions) {
    if (transaction.status !== "confirmed" && transaction.status !== "locked") {
      continue;
    }
    if (yearMonthOf(transaction.date) !== yearMonth) continue;

    transactionCount += 1;
    const entry = accountBreakdown[transaction.account] ?? {
      income: 0,
      expense: 0,
    };

    if (transaction.type === "income") {
      entry.income = addYen(entry.income, transaction.amount);
      totalIncome = addYen(totalIncome, transaction.amount);
    } else if (transaction.type === "expense") {
      entry.expense = addYen(entry.expense, transaction.amount);
      totalExpense = addYen(totalExpense, transaction.amount);
    } else {
      continue;
    }
    accountBreakdown[transaction.account] = entry;
  }

  return {
    id: yearMonth,
    totalIncome,
    totalExpense,
    accountBreakdown,
    transactionCount,
    computedAt,
  };
}
