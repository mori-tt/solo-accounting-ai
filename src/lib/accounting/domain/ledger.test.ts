import { describe, expect, it } from "vitest";
import {
  buildAccountLedger,
  buildJournal,
  buildTrialBalance,
  CASH_ACCOUNT,
  transactionToJournalEntry,
  type JournalEntry,
  type JournalTransaction,
} from "./ledger";
import type { TransactionStatus, TransactionType } from "./types";

function tx(
  id: string,
  type: TransactionType,
  date: string,
  amount: number,
  account = "sales",
  status: TransactionStatus = "confirmed",
): JournalTransaction {
  return {
    id,
    type,
    date,
    amount,
    account,
    counterparty: `cp-${id}`,
    description: `desc-${id}`,
    status,
  };
}

function entry(
  transactionId: string,
  date: string,
  debitAccount: string,
  creditAccount: string,
  amount: number,
): JournalEntry {
  return {
    transactionId,
    date,
    description: `desc-${transactionId}`,
    counterparty: `cp-${transactionId}`,
    lines: [
      { account: debitAccount, debit: amount, credit: 0 },
      { account: creditAccount, debit: 0, credit: amount },
    ],
  };
}

describe("transactionToJournalEntry", () => {
  it("incomeは借方=現金・貸方=科目に展開する", () => {
    const e = transactionToJournalEntry(
      tx("t1", "income", "2026-10-05", 100_000, "sales"),
    );
    expect(e.lines).toEqual([
      { account: CASH_ACCOUNT, debit: 100_000, credit: 0 },
      { account: "sales", debit: 0, credit: 100_000 },
    ]);
  });

  it("expenseは借方=科目・貸方=現金に展開する", () => {
    const e = transactionToJournalEntry(
      tx("t1", "expense", "2026-10-05", 30_000, "rent"),
    );
    expect(e.lines).toEqual([
      { account: "rent", debit: 30_000, credit: 0 },
      { account: CASH_ACCOUNT, debit: 0, credit: 30_000 },
    ]);
  });

  it("transferは借方=科目(振替先)・貸方=現金(振替元)に展開する", () => {
    const e = transactionToJournalEntry(
      tx("t1", "transfer", "2026-10-05", 40_000, "transfer"),
    );
    expect(e.lines).toEqual([
      { account: "transfer", debit: 40_000, credit: 0 },
      { account: CASH_ACCOUNT, debit: 0, credit: 40_000 },
    ]);
  });

  it("摘要・取引先・日付を引き継ぐ", () => {
    const e = transactionToJournalEntry(
      tx("t1", "income", "2026-10-05", 10_000),
    );
    expect(e.transactionId).toBe("t1");
    expect(e.date).toBe("2026-10-05");
    expect(e.description).toBe("desc-t1");
    expect(e.counterparty).toBe("cp-t1");
  });
});

describe("buildJournal", () => {
  it("確定済み取引を日付昇順で返す", () => {
    const entries = buildJournal([
      tx("t2", "income", "2026-10-20", 50_000),
      tx("t1", "expense", "2026-10-05", 30_000, "rent"),
      tx("t3", "income", "2026-10-01", 10_000),
    ]);
    expect(entries.map((e) => e.transactionId)).toEqual(["t3", "t1", "t2"]);
  });

  it("draft取引は仕訳に含めない", () => {
    const entries = buildJournal([
      tx("t1", "income", "2026-10-05", 100_000, "sales", "draft"),
      tx("t2", "income", "2026-10-06", 20_000),
      tx("t3", "income", "2026-10-07", 30_000, "sales", "locked"),
    ]);
    expect(entries.map((e) => e.transactionId)).toEqual(["t2", "t3"]);
  });

  it("同日の取引はtransactionId順になる", () => {
    const entries = buildJournal([
      tx("t2", "income", "2026-10-05", 20_000),
      tx("t1", "income", "2026-10-05", 10_000),
    ]);
    expect(entries.map((e) => e.transactionId)).toEqual(["t1", "t2"]);
  });

  it("対象取引がなければ空の仕訳帳を返す", () => {
    expect(buildJournal([])).toEqual([]);
  });
});

describe("buildAccountLedger", () => {
  const entries = [
    entry("t1", "2026-09-10", CASH_ACCOUNT, "sales", 100_000),
    entry("t2", "2026-10-05", CASH_ACCOUNT, "sales", 50_000),
    entry("t3", "2026-10-08", "rent", CASH_ACCOUNT, 30_000),
    entry("t4", "2026-10-12", "rent", CASH_ACCOUNT, 10_000),
  ];

  it("繰越残高と期間内の残高推移を返す", () => {
    const ledger = buildAccountLedger(entries, "rent", "2026-10-01");
    expect(ledger.normalBalance).toBe("debit");
    expect(ledger.openingBalance).toBe(0);
    expect(ledger.lines.map((l) => [l.date, l.debit, l.credit, l.balance])).toEqual([
      ["2026-10-08", 30_000, 0, 30_000],
      ["2026-10-12", 10_000, 0, 40_000],
    ]);
    expect(ledger.closingBalance).toBe(40_000);
  });

  it("期間開始前の転記は繰越残高に含める", () => {
    const ledger = buildAccountLedger(entries, "sales", "2026-10-01");
    expect(ledger.normalBalance).toBe("credit");
    expect(ledger.openingBalance).toBe(100_000);
    expect(ledger.lines).toHaveLength(1);
    expect(ledger.lines[0].credit).toBe(50_000);
    expect(ledger.lines[0].balance).toBe(150_000);
    expect(ledger.closingBalance).toBe(150_000);
  });

  it("借方・貸方の両側に転記がある科目は残高方向で符号が決まる", () => {
    const ledger = buildAccountLedger(entries, CASH_ACCOUNT, "2026-10-01");
    // 現金は借方超過(150,000-40,000)なので借方残高
    expect(ledger.normalBalance).toBe("debit");
    expect(ledger.openingBalance).toBe(100_000);
    expect(ledger.lines.map((l) => l.balance)).toEqual([
      150_000, 120_000, 110_000,
    ]);
    expect(ledger.closingBalance).toBe(110_000);
  });

  it("期間内の明細がなくても繰越・期末残高は返る", () => {
    const ledger = buildAccountLedger(entries, "sales", "2026-11-01");
    expect(ledger.lines).toEqual([]);
    expect(ledger.openingBalance).toBe(150_000);
    expect(ledger.closingBalance).toBe(150_000);
  });

  it("転記のない科目は残高0の空帳簿を返す", () => {
    const ledger = buildAccountLedger(entries, "supplies", "2026-10-01");
    expect(ledger.normalBalance).toBe("debit");
    expect(ledger.openingBalance).toBe(0);
    expect(ledger.lines).toEqual([]);
    expect(ledger.closingBalance).toBe(0);
  });

  it("periodStartは実在する日付でなければならない", () => {
    expect(() =>
      buildAccountLedger(entries, "sales", "2026-13-01"),
    ).toThrowError(/periodStart/);
  });
});

describe("buildTrialBalance", () => {
  it("科目別の貸借合計と残高を集計する", () => {
    const tb = buildTrialBalance([
      entry("t1", "2026-10-05", CASH_ACCOUNT, "sales", 100_000),
      entry("t2", "2026-10-08", "rent", CASH_ACCOUNT, 30_000),
      entry("t3", "2026-10-12", "rent", CASH_ACCOUNT, 10_000),
    ]);
    expect(tb.rows).toEqual([
      {
        account: CASH_ACCOUNT,
        debitTotal: 100_000,
        creditTotal: 40_000,
        balance: 60_000,
      },
      { account: "rent", debitTotal: 40_000, creditTotal: 0, balance: 40_000 },
      {
        account: "sales",
        debitTotal: 0,
        creditTotal: 100_000,
        balance: -100_000,
      },
    ]);
  });

  it("合計行は借方=貸方で一致する", () => {
    const tb = buildTrialBalance(
      buildJournal([
        tx("t1", "income", "2026-10-05", 100_000),
        tx("t2", "expense", "2026-10-08", 30_000, "rent"),
        tx("t3", "transfer", "2026-10-12", 40_000, "transfer"),
      ]),
    );
    expect(tb.debitTotal).toBe(170_000);
    expect(tb.creditTotal).toBe(170_000);
    expect(tb.balanced).toBe(true);
  });

  it("仕訳がなければ0の試算表を返す", () => {
    const tb = buildTrialBalance([]);
    expect(tb.rows).toEqual([]);
    expect(tb.debitTotal).toBe(0);
    expect(tb.creditTotal).toBe(0);
    expect(tb.balanced).toBe(true);
  });
});
