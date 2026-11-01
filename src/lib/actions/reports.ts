"use server";

import {
  computeMonthlySummary,
  recomputeMonthlySummary,
} from "@/lib/accounting/services/monthlySummary";
import { findUnpaidExpenses } from "@/lib/accounting/services/expenses";
import { findUnpaidInvoices } from "@/lib/accounting/services/sales";
import { monthKeyRange } from "@/lib/accounting/dates";
import type { MonthlySummary, Transaction } from "@/lib/accounting/types";
import { run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { monthKey, parseForm } from "@/lib/validation/schemas";

export interface MonthlyReport {
  /** monthlySummaries に保存済みの集計。未作成なら undefined */
  persisted?: MonthlySummary;
  /** 取引からその場で計算した現在値 */
  current: MonthlySummary;
}

/** 月次レポート。保存済みサマリと現在値の両方を返す。 */
export async function getMonthlyReport(
  businessId: string,
  monthKeyInput: string,
): Promise<ActionResult<MonthlyReport>> {
  const parsed = parseForm(monthKey, monthKeyInput);
  if (!parsed.success) return { ok: false, error: { code: "INVALID_INPUT", message: parsed.issues.join(" / ") } };
  return run(async () => {
    await requireViewer(businessId);
    const store = getStore();
    const key = parsed.data;
    const { startDate, endDate } = monthKeyRange(key);
    const [persisted, transactions] = await Promise.all([
      store.getMonthlySummary(businessId, key),
      store.listTransactionsInRange(businessId, startDate, endDate),
    ]);
    return {
      persisted,
      current: computeMonthlySummary(
        key,
        transactions,
        new Date().toISOString(),
      ),
    };
  });
}

/** monthlySummaries を再計算して保存する(集計は常にTransactionから再計算) */
export async function recomputeMonthlyReport(
  businessId: string,
  monthKeyInput: string,
): Promise<ActionResult<MonthlySummary>> {
  const parsed = parseForm(monthKey, monthKeyInput);
  if (!parsed.success) return { ok: false, error: { code: "INVALID_INPUT", message: parsed.issues.join(" / ") } };
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { summary } = await recomputeMonthlySummary(
      getStore(),
      businessId,
      actor,
      parsed.data,
    );
    return summary;
  });
}

export interface DashboardData {
  summary: MonthlySummary;
  draftCount: number;
  pendingSuggestionCount: number;
  unprocessedReceiptCount: number;
  unpaidExpenseCount: number;
  overdueExpenseCount: number;
  unpaidInvoiceCount: number;
  unpaidInvoiceAmount: number;
  overdueInvoiceCount: number;
  recentTransactions: Transaction[];
}

/** ダッシュボード用の集計。月次サマリはその場で計算する。 */
export async function getDashboard(
  businessId: string,
  input: { monthKey: string; asOf: string },
): Promise<ActionResult<DashboardData>> {
  const parsed = parseForm(monthKey, input.monthKey);
  if (!parsed.success) return { ok: false, error: { code: "INVALID_INPUT", message: parsed.issues.join(" / ") } };
  return run(async () => {
    await requireViewer(businessId);
    const store = getStore();
    const { startDate, endDate } = monthKeyRange(parsed.data);

    const [monthTx, allTx, receipts, unpaidExpenses, unpaidInvoices] =
      await Promise.all([
        store.listTransactionsInRange(businessId, startDate, endDate),
        store.listTransactionsInRange(businessId, "0001-01-01", "9999-12-31"),
        store.listReceipts(businessId, "unprocessed"),
        findUnpaidExpenses(store, businessId, input.asOf),
        findUnpaidInvoices(store, businessId, input.asOf),
      ]);

    const summary = computeMonthlySummary(
      parsed.data,
      monthTx,
      new Date().toISOString(),
    );
    const recentTransactions = [...allTx]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8);

    return {
      summary,
      draftCount: allTx.filter((t) => t.status === "draft").length,
      pendingSuggestionCount: allTx.filter(
        (t) => t.aiSuggestion?.status === "pending",
      ).length,
      unprocessedReceiptCount: receipts.length,
      unpaidExpenseCount: unpaidExpenses.length,
      overdueExpenseCount: unpaidExpenses.filter((u) => u.overdue).length,
      unpaidInvoiceCount: unpaidInvoices.length,
      unpaidInvoiceAmount: unpaidInvoices.reduce((s, u) => s + u.remaining, 0),
      overdueInvoiceCount: unpaidInvoices.filter((u) => u.overdue).length,
      recentTransactions,
    };
  });
}
