"use server";

import {
  buildAccountLedger,
  buildJournal,
  buildTrialBalance,
  type AccountLedger,
  type JournalEntry,
  type TrialBalance,
} from "@/lib/accounting/domain/ledger";
import {
  buildConsumptionTaxSummary,
  buildYearlyReport,
  type ConsumptionTaxSummary,
  type YearlyReport,
} from "@/lib/accounting/domain/yearly";
import {
  buildIncomeStatement,
  type IncomeStatement,
} from "@/lib/accounting/domain/filing";
import { fiscalPeriodRange } from "@/lib/accounting/domain/fiscal";
import {
  computeConsumptionTaxFiling,
  type ConsumptionTaxFiling,
} from "@/lib/accounting/domain/tax";
import { monthKeyRange } from "@/lib/accounting/dates";
import type { TaxMode } from "@/lib/accounting/types";
import { ApiError, fail, run, type ActionResult } from "@/lib/api/result";
import { requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { monthKey, parseForm } from "@/lib/validation/schemas";

/**
 * 帳簿レポートの Server Actions。
 * いずれも閲覧(viewer)権限で参照可。集計は保存せず、
 * 確定済みTransactionからその場で組み立てる(手計算値の保存禁止)。
 */

export interface JournalReport {
  entries: JournalEntry[];
}

/** 仕訳帳。月内の確定済み取引を複式仕訳へ展開し日付順で返す。 */
export async function getJournalReport(
  businessId: string,
  monthKeyInput: string,
): Promise<ActionResult<JournalReport>> {
  const parsed = parseForm(monthKey, monthKeyInput);
  if (!parsed.success) {
    return fail("INVALID_INPUT", parsed.issues.join(" / "));
  }
  return run(async () => {
    await requireViewer(businessId);
    const { startDate, endDate } = monthKeyRange(parsed.data);
    const transactions = await getStore().listTransactionsInRange(
      businessId,
      startDate,
      endDate,
    );
    return { entries: buildJournal(transactions) };
  });
}

export interface AccountLedgerReport {
  /** 帳簿に登場する科目コード一覧(cash勘定を含む・昇順) */
  accounts: string[];
  /** 表示対象の科目(account未指定・不明コードなら先頭科目) */
  selected: string | null;
  ledger: AccountLedger | null;
}

/**
 * 総勘定元帳。繰越残高の計算のため、月末までの全取引を読んで
 * 月初より前の転記を繰越に集約する。
 */
export async function getAccountLedgerReport(
  businessId: string,
  monthKeyInput: string,
  account?: string,
): Promise<ActionResult<AccountLedgerReport>> {
  const parsed = parseForm(monthKey, monthKeyInput);
  if (!parsed.success) {
    return fail("INVALID_INPUT", parsed.issues.join(" / "));
  }
  return run(async () => {
    await requireViewer(businessId);
    const { startDate, endDate } = monthKeyRange(parsed.data);
    const transactions = await getStore().listTransactionsInRange(
      businessId,
      "0001-01-01",
      endDate,
    );
    const entries = buildJournal(transactions);

    const accountSet = new Set<string>();
    for (const e of entries) {
      for (const line of e.lines) accountSet.add(line.account);
    }
    const accounts = [...accountSet].sort((a, b) => a.localeCompare(b));

    const selected =
      account && accountSet.has(account) ? account : (accounts[0] ?? null);
    return {
      accounts,
      selected,
      ledger: selected
        ? buildAccountLedger(entries, selected, startDate)
        : null,
    };
  });
}

/** 試算表。月内の確定済み取引から全科目の貸借合計を返す。 */
export async function getTrialBalanceReport(
  businessId: string,
  monthKeyInput: string,
): Promise<ActionResult<TrialBalance>> {
  const parsed = parseForm(monthKey, monthKeyInput);
  if (!parsed.success) {
    return fail("INVALID_INPUT", parsed.issues.join(" / "));
  }
  return run(async () => {
    await requireViewer(businessId);
    const { startDate, endDate } = monthKeyRange(parsed.data);
    const transactions = await getStore().listTransactionsInRange(
      businessId,
      startDate,
      endDate,
    );
    return buildTrialBalance(buildJournal(transactions));
  });
}

function validFiscalYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2200;
}

export interface YearlyReportData {
  fiscalYear: number;
  /** 事業の会計年度開始月 */
  fiscalYearStartMonth: number;
  /** 事業の消費税課税方式 */
  taxMode: TaxMode;
  report: YearlyReport;
  tax: ConsumptionTaxSummary;
  /**
   * 申告レベルの消費税概算。簡易課税は事業区分(みなし仕入率)が
   * 未設定のため null(概算を出さない)。免税事業者は納付額0の結果。
   */
  taxFiling: ConsumptionTaxFiling | null;
}

/**
 * 年次レポート。会計年度範囲の確定済み取引から
 * 月別推移・科目別年間合計・消費税区分別集計をその場で組み立てる。
 */
export async function getYearlyReport(
  businessId: string,
  fiscalYear: number,
): Promise<ActionResult<YearlyReportData>> {
  if (!validFiscalYear(fiscalYear)) {
    return fail("INVALID_INPUT", "年度が不正です");
  }
  return run(async () => {
    await requireViewer(businessId);
    const store = getStore();
    const business = await store.getBusiness(businessId);
    if (!business) {
      throw new ApiError("NOT_FOUND", "事業が見つかりません");
    }
    const { startDate, endDate } = fiscalPeriodRange(
      fiscalYear,
      business.fiscalYearStartMonth,
    );
    const [transactions, expenses] = await Promise.all([
      store.listTransactionsInRange(businessId, startDate, endDate),
      store.listExpenses(businessId),
    ]);
    const report = buildYearlyReport(
      transactions,
      fiscalYear,
      business.fiscalYearStartMonth,
    );
    const tax = buildConsumptionTaxSummary(transactions, expenses);
    const taxFiling =
      business.taxMode === "simple"
        ? null
        : computeConsumptionTaxFiling(business.taxMode, tax.filingAmounts);
    return {
      fiscalYear,
      fiscalYearStartMonth: business.fiscalYearStartMonth,
      taxMode: business.taxMode,
      report,
      tax,
      taxFiling,
    };
  });
}

export interface FilingStatementData {
  businessName: string;
  statement: IncomeStatement;
}

/**
 * 決算書(収支内訳書様式)用の年間収支。
 * 科目別年間合計を収支内訳書の部(収入金額/売上原価/経費)に振り分ける。
 */
export async function getFilingStatement(
  businessId: string,
  fiscalYear: number,
): Promise<ActionResult<FilingStatementData>> {
  if (!validFiscalYear(fiscalYear)) {
    return fail("INVALID_INPUT", "年度が不正です");
  }
  return run(async () => {
    await requireViewer(businessId);
    const store = getStore();
    const business = await store.getBusiness(businessId);
    if (!business) {
      throw new ApiError("NOT_FOUND", "事業が見つかりません");
    }
    const { startDate, endDate } = fiscalPeriodRange(
      fiscalYear,
      business.fiscalYearStartMonth,
    );
    const transactions = await store.listTransactionsInRange(
      businessId,
      startDate,
      endDate,
    );
    return {
      businessName: business.name,
      statement: buildIncomeStatement(
        buildYearlyReport(
          transactions,
          fiscalYear,
          business.fiscalYearStartMonth,
        ),
      ),
    };
  });
}
