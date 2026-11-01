import { describe, expect, it } from "vitest";
import {
  ACTOR,
  BIZ,
  NOW,
  expectDomainError,
  setup,
} from "./test-helpers";
import type { ExpenseInput, TransactionInput } from "./domain/validate";

function txInput(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    type: "income",
    date: "2026-10-15",
    amount: 100_000,
    account: "sales",
    counterparty: "client-a",
    description: "work",
    ...overrides,
  };
}

function expInput(overrides: Partial<ExpenseInput> = {}): ExpenseInput {
  return {
    type: "expense",
    date: "2026-10-15",
    amount: 11_000,
    account: "supplies",
    counterparty: "vendor",
    description: "supplies",
    taxCategory: "taxable",
    taxAmount: 1_000,
    ...overrides,
  };
}

describe("会計期間", () => {
  it("暦年の会計期間をopenで作成する", async () => {
    const { service } = setup();
    const period = await service.openFiscalYear(BIZ, 2026, 1, ACTOR);
    expect(period).toMatchObject({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "open",
    });
  });

  it("期間の重複作成を拒否する", async () => {
    const { service } = setup();
    await service.openFiscalYear(BIZ, 2026, 1, ACTOR);
    await expectDomainError(
      service.createFiscalPeriod(
        BIZ,
        { startDate: "2026-06-01", endDate: "2027-05-31" },
        ACTOR,
      ),
      "VALIDATION_FAILED",
    );
  });
});

describe("年度境界と締め済み期間", () => {
  it("4月始まりの年度は3月末に終わる", async () => {
    const { service } = setup();
    const period = await service.openFiscalYear(BIZ, 2025, 4, ACTOR);
    expect(period.endDate).toBe("2026-03-31");
  });

  it("締めた年度内の取引登録・変更を拒否する", async () => {
    const { service } = setup();
    const period = await service.openFiscalYear(BIZ, 2025, 4, ACTOR);

    await service.registerTransaction(
      BIZ,
      txInput({ date: "2026-03-31" }),
      ACTOR,
    );
    await service.closeFiscalPeriod(BIZ, period.id, ACTOR);

    await expectDomainError(
      service.registerTransaction(BIZ, txInput({ date: "2026-03-31" }), ACTOR),
      "PERIOD_CLOSED",
    );
    await expectDomainError(
      service.registerTransaction(BIZ, txInput({ date: "2025-04-01" }), ACTOR),
      "PERIOD_CLOSED",
    );
  });

  it("締めた年度の翌日の取引は登録できる", async () => {
    const { service } = setup();
    const period = await service.openFiscalYear(BIZ, 2025, 4, ACTOR);
    await service.closeFiscalPeriod(BIZ, period.id, ACTOR);
    const { transaction } = await service.registerTransaction(
      BIZ,
      txInput({ date: "2026-04-01" }),
      ACTOR,
    );
    expect(transaction.status).toBe("draft");
  });

  it("締め済み期間内の取引は更新・削除・確定を拒否する", async () => {
    const { service } = setup();
    const period = await service.openFiscalYear(BIZ, 2026, 1, ACTOR);
    const { transaction } = await service.registerTransaction(
      BIZ,
      txInput({ date: "2026-10-15" }),
      ACTOR,
    );
    await service.closeFiscalPeriod(BIZ, period.id, ACTOR);

    await expectDomainError(
      service.updateTransaction(BIZ, transaction.id, { amount: 1 }, ACTOR),
      "INVALID_STATE",
    );
    await expectDomainError(
      service.deleteTransaction(BIZ, transaction.id, ACTOR),
      "INVALID_STATE",
    );
    await expectDomainError(
      service.confirmTransaction(BIZ, transaction.id, ACTOR),
      "INVALID_STATE",
    );
  });

  it("締め処理は期間内の取引をlockedにする", async () => {
    const { service, store } = setup();
    const period = await service.openFiscalYear(BIZ, 2026, 1, ACTOR);
    const inside = await service.registerTransaction(
      BIZ,
      txInput({ date: "2026-10-15" }),
      ACTOR,
    );
    const outside = await service.registerTransaction(
      BIZ,
      txInput({ date: "2027-01-10" }),
      ACTOR,
    );

    const result = await service.closeFiscalPeriod(BIZ, period.id, ACTOR);
    expect(result.period.status).toBe("closed");
    expect(result.period.closedBy).toBe(ACTOR);
    expect(result.lockedTransactionIds).toEqual([inside.transaction.id]);

    const locked = await store.get(
      BIZ,
      "transactions",
      inside.transaction.id,
    );
    expect(locked?.status).toBe("locked");
    const free = await store.get(BIZ, "transactions", outside.transaction.id);
    expect(free?.status).toBe("draft");
  });

  it("二重の締め処理を拒否する", async () => {
    const { service } = setup();
    const period = await service.openFiscalYear(BIZ, 2026, 1, ACTOR);
    await service.closeFiscalPeriod(BIZ, period.id, ACTOR);
    await expectDomainError(
      service.closeFiscalPeriod(BIZ, period.id, ACTOR),
      "INVALID_STATE",
    );
  });

  it("締め済み期間への支払記録を拒否する", async () => {
    const { service } = setup();
    const period = await service.openFiscalYear(BIZ, 2026, 1, ACTOR);
    const { expense } = await service.registerExpense(
      BIZ,
      expInput({ date: "2026-10-15", paymentDueDate: "2026-11-30" }),
      ACTOR,
    );
    await service.closeFiscalPeriod(BIZ, period.id, ACTOR);
    await expectDomainError(
      service.markExpensePaid(BIZ, expense.id, "2027-01-15", ACTOR),
      "INVALID_STATE",
    );
  });
});

describe("月次集計", () => {
  it("confirmed取引から月次サマリを再計算する", async () => {
    const { service, store } = setup();
    const income = await service.registerTransaction(
      BIZ,
      txInput({ amount: 100_000 }),
      ACTOR,
    );
    await service.confirmTransaction(BIZ, income.transaction.id, ACTOR);
    await service.registerTransaction(
      BIZ,
      txInput({ amount: 999_999 }),
      ACTOR,
    );

    const summary = await service.recomputeMonthlySummary(BIZ, "2026-10");
    expect(summary.totalIncome).toBe(100_000);
    expect(summary.transactionCount).toBe(1);
    expect(summary.computedAt).toEqual(NOW);

    const stored = await store.get(BIZ, "monthlySummaries", "2026-10");
    expect(stored?.totalIncome).toBe(100_000);
  });

  it("翌月の取引を追加後に再計算すると両月が分かれる", async () => {
    const { service } = setup();
    const oct = await service.registerTransaction(
      BIZ,
      txInput({ date: "2026-10-31", amount: 10_000 }),
      ACTOR,
    );
    const nov = await service.registerTransaction(
      BIZ,
      txInput({ date: "2026-11-01", amount: 20_000 }),
      ACTOR,
    );
    await service.confirmTransaction(BIZ, oct.transaction.id, ACTOR);
    await service.confirmTransaction(BIZ, nov.transaction.id, ACTOR);

    const october = await service.recomputeMonthlySummary(BIZ, "2026-10");
    const november = await service.recomputeMonthlySummary(BIZ, "2026-11");
    expect(october.totalIncome).toBe(10_000);
    expect(november.totalIncome).toBe(20_000);
  });

  it("不正な年月を拒否する", async () => {
    const { service } = setup();
    await expectDomainError(
      service.recomputeMonthlySummary(BIZ, "2026-13"),
      "INVALID_DATE",
    );
  });
});

describe("決算チェック", () => {
  it("期間内の未処理項目を一覧する", async () => {
    const { service } = setup();
    const period = await service.openFiscalYear(BIZ, 2026, 1, ACTOR);

    await service.registerTransaction(
      BIZ,
      txInput({ date: "2026-10-15" }),
      ACTOR,
    );
    const confirmed = await service.registerTransaction(
      BIZ,
      txInput({ type: "expense", date: "2026-10-16" }),
      ACTOR,
    );
    await service.confirmTransaction(BIZ, confirmed.transaction.id, ACTOR);
    await service.registerExpense(
      BIZ,
      expInput({ paymentDueDate: "2026-12-01" }),
      ACTOR,
    );
    const customer = await service.registerCustomer(
      BIZ,
      { name: "c" },
      ACTOR,
    );
    const { invoice } = await service.registerInvoice(
      BIZ,
      {
        customerId: customer.id,
        issueDate: "2026-10-01",
        dueDate: "2026-11-30",
        items: [
          { description: "w", quantity: 1, unitPrice: 5_000, amount: 5_000 },
        ],
      },
      ACTOR,
    );
    await service.issueInvoice(BIZ, invoice.id, ACTOR);
    await service.registerReceipt(
      BIZ,
      { storagePath: "p", fileName: "f", mimeType: "application/pdf" },
      ACTOR,
    );

    const checklist = await service.buildClosingChecklist(BIZ, period.id);
    expect(checklist.ready).toBe(false);
    const byKey = Object.fromEntries(
      checklist.items.map((item) => [item.key, item]),
    );
    expect(byKey.draft_transactions.count).toBe(2);
    expect(byKey.unattached_receipts.count).toBe(1);
    expect(byKey.unpaid_expenses.count).toBe(1);
    expect(byKey.unpaid_invoices.count).toBe(1);
    expect(byKey.unprocessed_receipts.count).toBe(1);
  });

  it("全項目解消でready=trueになる", async () => {
    const { service } = setup();
    const period = await service.openFiscalYear(BIZ, 2026, 1, ACTOR);
    const { transaction } = await service.registerTransaction(
      BIZ,
      txInput(),
      ACTOR,
    );
    await service.confirmTransaction(BIZ, transaction.id, ACTOR);
    const checklist = await service.buildClosingChecklist(BIZ, period.id);
    expect(checklist.ready).toBe(true);
  });
});

describe("監査ログ", () => {
  it("全ての変更操作を記録する", async () => {
    const { service } = setup();
    const { transaction } = await service.registerTransaction(
      BIZ,
      txInput(),
      ACTOR,
    );
    await service.updateTransaction(BIZ, transaction.id, { amount: 1 }, ACTOR);
    await service.confirmTransaction(BIZ, transaction.id, ACTOR);
    await service.deleteTransaction(BIZ, transaction.id, ACTOR);

    const logs = await service.listAuditLogs(BIZ);
    expect(logs.map((l) => l.action)).toEqual([
      "create",
      "update",
      "update",
      "delete",
    ]);
    expect(
      logs.every((l) =>
        l.targetPath.startsWith(`businesses/${BIZ}/transactions/`),
      ),
    ).toBe(true);
    expect(logs.every((l) => l.actorUid === ACTOR)).toBe(true);
  });

  it("操作が失敗した場合は途中の書き込みも残らない", async () => {
    const { service, store } = setup();
    const period = await service.openFiscalYear(BIZ, 2026, 1, ACTOR);
    await service.closeFiscalPeriod(BIZ, period.id, ACTOR);
    const logsBefore = (await service.listAuditLogs(BIZ)).length;
    const periodsBefore = await store.list(BIZ, "fiscalPeriods");

    await expectDomainError(
      service.createFiscalPeriod(
        BIZ,
        { startDate: "2026-06-01", endDate: "2027-05-31" },
        ACTOR,
      ),
      "VALIDATION_FAILED",
    );
    expect(await store.list(BIZ, "fiscalPeriods")).toEqual(periodsBefore);
    expect((await service.listAuditLogs(BIZ)).length).toBe(logsBefore);
  });
});
