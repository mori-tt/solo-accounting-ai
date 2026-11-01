import { assertISODate, compareISODate, type ISODate } from "./dates";
import { addYen } from "./money";
import type { TransactionEntity } from "./types";

/**
 * 帳簿(仕訳帳・総勘定元帳・試算表)の組み立て。
 * Transaction は1行取引(type + 1科目 + 金額)なので、帳簿表示用に
 * 現金勘定を相手科目とする複式仕訳へ展開する。
 * 仕訳は確定済み(confirmed/locked)取引のみから生成する。draftは未確定の
 * 入力途中データであり、月次集計と同様に帳簿には載せない。
 */

/** 取引の資金側の相手科目として使う現金勘定コード(科目マスタ外の内部コード) */
export const CASH_ACCOUNT = "cash";

/** 仕訳展開に必要な取引項目 */
export type JournalTransaction = Pick<
  TransactionEntity,
  | "id"
  | "type"
  | "date"
  | "amount"
  | "account"
  | "counterparty"
  | "description"
  | "status"
>;

/** 仕訳の明細行(借方・貸方のどちらか片方のみ金額を持つ) */
export interface JournalLine {
  account: string;
  /** 借方金額(円・整数)。借方でない行は0 */
  debit: number;
  /** 貸方金額(円・整数)。貸方でない行は0 */
  credit: number;
}

/** 取引1件から展開した仕訳。lines[0]が借方行、lines[1]が貸方行 */
export interface JournalEntry {
  transactionId: string;
  date: ISODate;
  description: string;
  counterparty: string;
  lines: readonly [JournalLine, JournalLine];
}

/**
 * 取引を複式仕訳へ展開する。
 * - income:   借方=現金 / 貸方=account(収益科目)
 * - expense:  借方=account(費用科目) / 貸方=現金
 * - transfer: 借方=account(振替先) / 貸方=現金(振替元)
 *
 * Transaction は振替の相手科目を持たないため、transfer は収支と同じ
 * 「現金相手」モデルに合わせて「現金→accountへの資金移動」として展開する。
 * 振替は収支を構成しない(借方は収益科目ではない)点は月次集計と同じ扱い。
 */
export function transactionToJournalEntry(
  transaction: JournalTransaction,
): JournalEntry {
  const debit: JournalLine =
    transaction.type === "income"
      ? { account: CASH_ACCOUNT, debit: transaction.amount, credit: 0 }
      : { account: transaction.account, debit: transaction.amount, credit: 0 };
  const credit: JournalLine =
    transaction.type === "income"
      ? { account: transaction.account, debit: 0, credit: transaction.amount }
      : { account: CASH_ACCOUNT, debit: 0, credit: transaction.amount };
  return {
    transactionId: transaction.id,
    date: transaction.date,
    description: transaction.description,
    counterparty: transaction.counterparty,
    lines: [debit, credit],
  };
}

/** 確定済み取引を日付昇順の仕訳帳へ展開する(同日はtransactionId順) */
export function buildJournal(
  transactions: readonly JournalTransaction[],
): JournalEntry[] {
  return transactions
    .filter(
      (t) => t.status === "confirmed" || t.status === "locked",
    )
    .map(transactionToJournalEntry)
    .sort(
      (a, b) =>
        compareISODate(a.date, b.date) ||
        a.transactionId.localeCompare(b.transactionId),
    );
}

/** 総勘定元帳の明細行 */
export interface LedgerLine {
  transactionId: string;
  date: ISODate;
  description: string;
  counterparty: string;
  /** 借方金額(円・整数)。貸方行なら0 */
  debit: number;
  /** 貸方金額(円・整数)。借方行なら0 */
  credit: number;
  /** この行反映後の残高(円・整数。残高方向 normalBalance 側を正とする) */
  balance: number;
}

/** 科目の残高方向 */
export type LedgerBalanceSide = "debit" | "credit";

/** 科目別の総勘定元帳 */
export interface AccountLedger {
  account: string;
  /** 残高方向(全期間の貸借合計が大きい側。同数は借方) */
  normalBalance: LedgerBalanceSide;
  /** periodStart より前の繰越残高(残高方向を正とする符号付き) */
  openingBalance: number;
  /** periodStart 以降の明細行(日付昇順) */
  lines: LedgerLine[];
  /** 期末残高 = openingBalance + 当期明細の増減 */
  closingBalance: number;
}

/**
 * 科目別の総勘定元帳を組み立てる。
 * entries には少なくとも期間開始日まで遡る分を含む全期間の仕訳を渡すこと。
 * periodStart より前の転記は繰越残高に、以降は明細行になる。
 * 残高方向は全期間の貸借合計が大きい側(残高が出るのが普通の側)とする。
 * 勘定体系マスタが無いため、科目の性質は貸借どちらの合計が大きいかで判定する
 * (収益科目は貸方、費用・資産科目は借方が大きくなる)。
 */
export function buildAccountLedger(
  entries: readonly JournalEntry[],
  account: string,
  periodStart: ISODate,
): AccountLedger {
  assertISODate(periodStart, "periodStart");

  const postings: { entry: JournalEntry; line: JournalLine }[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.account !== account) continue;
      postings.push({ entry, line });
      totalDebit = addYen(totalDebit, line.debit);
      totalCredit = addYen(totalCredit, line.credit);
    }
  }
  postings.sort(
    (a, b) =>
      compareISODate(a.entry.date, b.entry.date) ||
      a.entry.transactionId.localeCompare(b.entry.transactionId),
  );

  const normalBalance: LedgerBalanceSide =
    totalDebit >= totalCredit ? "debit" : "credit";
  const signed = (debit: number, credit: number): number =>
    normalBalance === "debit" ? debit - credit : credit - debit;

  let openingBalance = 0;
  let periodMovement = 0;
  const lines: LedgerLine[] = [];
  for (const { entry, line } of postings) {
    const movement = signed(line.debit, line.credit);
    if (entry.date < periodStart) {
      openingBalance = addYen(openingBalance, movement);
      continue;
    }
    periodMovement = addYen(periodMovement, movement);
    lines.push({
      transactionId: entry.transactionId,
      date: entry.date,
      description: entry.description,
      counterparty: entry.counterparty,
      debit: line.debit,
      credit: line.credit,
      balance: addYen(openingBalance, periodMovement),
    });
  }

  return {
    account,
    normalBalance,
    openingBalance,
    lines,
    closingBalance: addYen(openingBalance, periodMovement),
  };
}

/** 試算表の科目別行 */
export interface TrialBalanceRow {
  account: string;
  /** 借方合計(円・整数) */
  debitTotal: number;
  /** 貸方合計(円・整数) */
  creditTotal: number;
  /** debitTotal - creditTotal(正=借方残高、負=貸方残高) */
  balance: number;
}

/** 試算表(科目別の貸借合計と残高) */
export interface TrialBalance {
  /** 科目コード昇順 */
  rows: TrialBalanceRow[];
  /** 全科目の借方合計 */
  debitTotal: number;
  /** 全科目の貸方合計 */
  creditTotal: number;
  /** 借方合計と貸方合計の一致確認 */
  balanced: boolean;
}

/**
 * 仕訳から試算表を組み立てる。
 * 各仕訳は貸借一致しているため合計行は必ず借方=貸方になる。
 */
export function buildTrialBalance(
  entries: readonly JournalEntry[],
): TrialBalance {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const acc = byAccount.get(line.account) ?? { debit: 0, credit: 0 };
      acc.debit = addYen(acc.debit, line.debit);
      acc.credit = addYen(acc.credit, line.credit);
      byAccount.set(line.account, acc);
    }
  }

  const rows = [...byAccount.entries()]
    .map(([account, totals]) => ({
      account,
      debitTotal: totals.debit,
      creditTotal: totals.credit,
      balance: totals.debit - totals.credit,
    }))
    .sort((a, b) => a.account.localeCompare(b.account));

  const debitTotal = rows.reduce((sum, r) => addYen(sum, r.debitTotal), 0);
  const creditTotal = rows.reduce((sum, r) => addYen(sum, r.creditTotal), 0);
  return {
    rows,
    debitTotal,
    creditTotal,
    balanced: debitTotal === creditTotal,
  };
}
