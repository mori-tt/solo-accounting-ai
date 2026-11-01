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
  fiscalPeriodBounds,
  fiscalPeriodOf,
  monthKeyRange,
} from "@/lib/accounting/dates";
import { fail, run, type ActionResult } from "@/lib/api/result";
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
    // 期首残高の仮想仕訳を末尾に連結し、繰越残高へ反映する
    const entries = [
      ...buildJournal(transactions),
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
    await requireViewer(businessId);
    const { startDate, endDate } = monthKeyRange(parsed.data);
    const transactions = await getStore().listTransactionsInRange(
      businessId,
      startDate,
      endDate,
    );
    return buildTrialBalance([
      ...buildJournal(transactions),
      ...(await openingEntriesFor(businessId, startDate)),
    ]);
  });
}
