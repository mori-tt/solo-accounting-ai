"use server";

import {
  buildAccountLedger,
  buildJournal,
  buildTrialBalance,
  openingBalanceJournalEntries,
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
import {
  fiscalPeriodRange,
  type DateRange,
} from "@/lib/accounting/domain/fiscal";
import {
  computeConsumptionTaxFiling,
  type ConsumptionTaxFiling,
  type FilingTaxableAmounts,
} from "@/lib/accounting/domain/tax";
import {
  fiscalPeriodBounds,
  fiscalPeriodOf,
  monthKeyRange,
} from "@/lib/accounting/dates";
import { inventoryTotalAmount } from "@/lib/accounting/domain/inventory";
import { inventoryCountId } from "@/lib/accounting/services/inventory";
import type { TaxMode } from "@/lib/accounting/types";
import { actionReadRateLimiter } from "@/lib/api/rate-limit";
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

/**
 * 指定日付を含む会計年度の期首残高を繰越用の仮想仕訳へ展開する。
 * 転記日は前会計年度の末日とし、当年度のどの月の帳簿でも
 * 明細行ではなく繰越残高側に集約されるようにする。
 */
async function openingEntriesFor(
  businessId: string,
  dateInFiscalYear: string,
): Promise<JournalEntry[]> {
  const business = await getStore().getBusiness(businessId);
  const startMonth = business?.fiscalYearStartMonth ?? 1;
  const { fiscalYear } = fiscalPeriodOf(dateInFiscalYear, startMonth);
  const carryoverDate = fiscalPeriodBounds(fiscalYear - 1, startMonth).endDate;
  return openingBalanceJournalEntries(
    business?.openingBalances ?? [],
    fiscalYear,
    carryoverDate,
  );
}

/**
 * withholdingRecords から transactionId→源泉徴収税額 のマップを組み立てる。
 * 仕訳展開で貸方を現金(差引額)と預り金(税額)に分けるために使う。
 */
async function withholdingTaxByTransaction(
  businessId: string,
): Promise<Map<string, number>> {
  const records = await getStore().listWithholdingRecords(businessId);
  return new Map(records.map((r) => [r.transactionId, r.taxAmount]));
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
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const { startDate, endDate } = monthKeyRange(parsed.data);
    const store = getStore();
    const [transactions, withholdingTax] = await Promise.all([
      store.listTransactionsInRange(businessId, startDate, endDate),
      withholdingTaxByTransaction(businessId),
    ]);
    return { entries: buildJournal(transactions, withholdingTax) };
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
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const { startDate, endDate } = monthKeyRange(parsed.data);
    const store = getStore();
    const [transactions, withholdingTax] = await Promise.all([
      store.listTransactionsInRange(businessId, "0001-01-01", endDate),
      withholdingTaxByTransaction(businessId),
    ]);
    // 期首残高の仮想仕訳を末尾に連結し、繰越残高へ反映する
    const entries = [
      ...buildJournal(transactions, withholdingTax),
      ...(await openingEntriesFor(businessId, startDate)),
    ];

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
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const { startDate, endDate } = monthKeyRange(parsed.data);
    const store = getStore();
    const [transactions, withholdingTax] = await Promise.all([
      store.listTransactionsInRange(businessId, startDate, endDate),
      withholdingTaxByTransaction(businessId),
    ]);
    return buildTrialBalance([
      ...buildJournal(transactions, withholdingTax),
      ...(await openingEntriesFor(businessId, startDate)),
    ]);
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
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
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

export interface ConsumptionTaxFilingData {
  businessName: string;
  fiscalYear: number;
  /** 会計年度の期間範囲 */
  range: DateRange;
  /** 事業の消費税課税方式 */
  taxMode: TaxMode;
  /**
   * computeConsumptionTaxFiling への入力(課税売上・課税仕入の税率別税込合計)。
   * 簡易課税の事業区分(みなし仕入率)はBusinessに保持しないため、
   * 納付額の算出は画面側で選択値を使って行う。
   */
  filingAmounts: FilingTaxableAmounts[];
  /** taxCategory 未設定の集計対象取引件数 */
  unclassifiedCount: number;
}

/**
 * 消費税申告用納付税額計算シート用の集計。
 * 会計年度範囲の確定済み取引から税率別の課税対価・仕入対価を集計して返す。
 * 集計は保存せず確定済みTransactionからその場で組み立てる(手計算値の保存禁止)。
 */
export async function getConsumptionTaxFilingData(
  businessId: string,
  fiscalYear: number,
): Promise<ActionResult<ConsumptionTaxFilingData>> {
  if (!validFiscalYear(fiscalYear)) {
    return fail("INVALID_INPUT", "年度が不正です");
  }
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const store = getStore();
    const business = await store.getBusiness(businessId);
    if (!business) {
      throw new ApiError("NOT_FOUND", "事業が見つかりません");
    }
    const range = fiscalPeriodRange(
      fiscalYear,
      business.fiscalYearStartMonth,
    );
    const [transactions, expenses] = await Promise.all([
      store.listTransactionsInRange(
        businessId,
        range.startDate,
        range.endDate,
      ),
      store.listExpenses(businessId),
    ]);
    const tax = buildConsumptionTaxSummary(transactions, expenses);
    return {
      businessName: business.name,
      fiscalYear,
      range,
      taxMode: business.taxMode,
      filingAmounts: tax.filingAmounts,
      unclassifiedCount: tax.unclassifiedCount,
    };
  });
}

export interface FilingStatementData {
  businessName: string;
  statement: IncomeStatement;
  /**
   * 期首商品棚卸高(円・整数)。前年度の棚卸カウント合計
   * (inventoryCounts/fy{fiscalYear-1})。未入力は0。
   */
  beginningInventory: number;
  /**
   * 期末商品棚卸高(円・整数)。対象年度の棚卸カウント合計
   * (inventoryCounts/fy{fiscalYear})。未入力は0。
   */
  endingInventory: number;
}

/**
 * 決算書(収支内訳書様式)用の年間収支。
 * 科目別年間合計を収支内訳書の部(収入金額/売上原価/経費)に振り分ける。
 * 棚卸高は対象年度・前年度の棚卸カウント(inventoryCounts)の合計を返し、
 * 画面側で手入力上書きできる初期値として使う(集計値は保存しない)。
 */
export async function getFilingStatement(
  businessId: string,
  fiscalYear: number,
): Promise<ActionResult<FilingStatementData>> {
  if (!validFiscalYear(fiscalYear)) {
    return fail("INVALID_INPUT", "年度が不正です");
  }
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const store = getStore();
    const business = await store.getBusiness(businessId);
    if (!business) {
      throw new ApiError("NOT_FOUND", "事業が見つかりません");
    }
    const { startDate, endDate } = fiscalPeriodRange(
      fiscalYear,
      business.fiscalYearStartMonth,
    );
    const [transactions, beginningCount, endingCount] = await Promise.all([
      store.listTransactionsInRange(businessId, startDate, endDate),
      store.getInventoryCount(businessId, inventoryCountId(fiscalYear - 1)),
      store.getInventoryCount(businessId, inventoryCountId(fiscalYear)),
    ]);
    return {
      businessName: business.name,
      statement: buildIncomeStatement(
        buildYearlyReport(
          transactions,
          fiscalYear,
          business.fiscalYearStartMonth,
        ),
      ),
      beginningInventory: inventoryTotalAmount(beginningCount?.lines ?? []),
      endingInventory: inventoryTotalAmount(endingCount?.lines ?? []),
    };
  });
}
