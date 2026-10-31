import { describe, expect, it } from "vitest";
import { setupStore } from "../testing";
import { registerExpense } from "./expenses";
import {
  closeFiscalPeriod,
  closingChecklist,
  ensureFiscalPeriodForDate,
  fiscalPeriodIdOf,
} from "./periods";
import { registerReceipt } from "./receipts";
import {
  registerCustomer,
  registerInvoice,
  issueInvoice,
} from "./sales";
import {
  confirmTransaction,
  registerTransaction,
} from "./transactions";

describe("ensureFiscalPeriodForDate / 年度境界", () => {
  it("暦年事業: 2025-06-10 は fy2025", async () => {
    const { store, businessId, actor } = await setupStore(1);
    const { period, created } = await ensureFiscalPeriodForDate(
      store,
      businessId,
      actor,
      "2025-06-10",
    );
    expect(created).toBe(true);
    expect(period.id).toBe("fy2025");
    expect(period.startDate).toBe("2025-01-01");
    expect(period.endDate).toBe("2025-12-31");
    // 再実行は既存を返す
    const again = await ensureFiscalPeriodForDate(
      store,
      businessId,
      actor,
      "2025-12-31",
    );
    expect(again.created).toBe(false);
    expect(again.period.id).toBe("fy2025");
  });

  it("4月始まり事業: 3/31 と 4/1 で年度が分かれる", async () => {
    const { store, businessId, actor } = await setupStore(4);
    const mar = await ensureFiscalPeriodForDate(
      store,
      businessId,
      actor,
      "2026-03-31",
    );
    const apr = await ensureFiscalPeriodForDate(
      store,
      businessId,
      actor,
      "2026-04-01",
    );
    expect(mar.period.id).toBe("fy2025");
    expect(apr.period.id).toBe("fy2026");
    expect(mar.period.endDate).toBe("2026-03-31");
    expect(apr.period.startDate).toBe("2026-04-01");
    expect(fiscalPeriodIdOf("2026-03-31", 4).id).toBe("fy2025");
  });
});

async function seedPeriodWithData() {
  const env = await setupStore(1);
  const { store, businessId, actor } = env;
  await ensureFiscalPeriodForDate(store, businessId, actor, "2025-03-01");
  // 確定済み取引(証憑なし経費)
  const exp = await registerExpense(store, businessId, actor, {
    idempotencyKey: "exp-c",
    date: "2025-03-10",
    amount: 10_000,
    account: "supplies",
    taxCategory: "taxable",
    taxAmount: 909,
    paymentDueDate: "2025-04-01",
  });
  await confirmTransaction(store, businessId, actor, exp.transaction.id);
  // 確定済み売上
  const inc = await registerTransaction(store, businessId, actor, {
    idempotencyKey: "tx-c",
    type: "income",
    date: "2025-03-20",
    amount: 100_000,
    account: "sales",
  });
  await confirmTransaction(store, businessId, actor, inc.transaction.id);
  // 未処理証憑
  await registerReceipt(store, businessId, actor, {
    id: "r-unproc",
    storagePath: "receipts/biz/r-unproc/a.pdf",
    fileName: "a.pdf",
    mimeType: "application/pdf",
  });
  return env;
}

describe("closingChecklist(決算チェック)", () => {
  it("証憑未添付・未払経費・未入金売上・draftを洗い出す", async () => {
    const { store, businessId, actor } = await seedPeriodWithData();
    // 未入金請求書(期日内issue・期限超過)
    await registerCustomer(store, businessId, actor, { id: "c1", name: "A" });
    const { invoice } = await registerInvoice(store, businessId, actor, {
      idempotencyKey: "inv-c",
      customerId: "c1",
      issueDate: "2025-03-05",
      dueDate: "2025-03-31",
      items: [{ description: "x", quantity: 1, unitPrice: 50_000, amount: 50_000 }],
    });
    await issueInvoice(store, businessId, actor, invoice.id);
    // draft取引(締めをブロック)
    await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-draft",
      type: "income",
      date: "2025-03-25",
      amount: 5_000,
      account: "sales",
    });

    const checklist = await closingChecklist(
      store,
      businessId,
      "fy2025",
      "2025-04-10",
    );
    expect(checklist.missingReceiptTransactions).toHaveLength(1); // 経費のみ
    expect(checklist.missingReceiptTransactions[0].type).toBe("expense");
    expect(checklist.unprocessedReceiptIds).toEqual(["r-unproc"]);
    expect(checklist.unpaidExpenses).toHaveLength(1);
    expect(checklist.unpaidExpenses[0].overdue).toBe(true);
    expect(checklist.unpaidInvoices).toHaveLength(1);
    expect(checklist.unpaidInvoices[0].invoice.id).toBe(invoice.id);
    expect(checklist.draftTransactions).toHaveLength(1);
    expect(checklist.canClose).toBe(false);
  });
});

describe("closeFiscalPeriod(締め)", () => {
  it("confirmed取引をlockedにし期間をclosedにする", async () => {
    const { store, businessId, actor } = await seedPeriodWithData();
    const { period, lockedTransactions, replayed } = await closeFiscalPeriod(
      store,
      businessId,
      actor,
      "fy2025",
      "close-fy2025",
    );
    expect(replayed).toBe(false);
    expect(period.status).toBe("closed");
    expect(period.closedBy).toBe(actor.uid);
    expect(lockedTransactions).toBe(2);

    const logs = await store.listAuditLogs(businessId);
    expect(
      logs.some(
        (l) =>
          l.action === "close" &&
          l.targetPath === `businesses/${businessId}/fiscalPeriods/fy2025`,
      ),
    ).toBe(true);
  });

  it("締め済み期間への再締め・データ変更・新規登録を拒否する", async () => {
    const { store, businessId, actor } = await seedPeriodWithData();
    await closeFiscalPeriod(store, businessId, actor, "fy2025", "close-1");

    await expect(
      closeFiscalPeriod(store, businessId, actor, "fy2025", "close-2"),
    ).rejects.toMatchObject({ code: "PERIOD_NOT_OPEN" });

    // 期間内日付の新規取引は拒否
    await expect(
      registerTransaction(store, businessId, actor, {
        idempotencyKey: "tx-locked-period",
        type: "income",
        date: "2025-06-01",
        amount: 1_000,
        account: "sales",
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });

    // locked取引のconfirmも拒否
    const txns = await store.listTransactionsInRange(
      businessId,
      "2025-01-01",
      "2025-12-31",
    );
    expect(txns.every((t) => t.status === "locked")).toBe(true);
    await expect(
      confirmTransaction(store, businessId, actor, txns[0].id),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("締め後も期間外の取引は登録できる", async () => {
    const { store, businessId, actor } = await seedPeriodWithData();
    await closeFiscalPeriod(store, businessId, actor, "fy2025", "close-1");
    const { transaction } = await registerTransaction(
      store,
      businessId,
      actor,
      {
        idempotencyKey: "tx-next-fy",
        type: "income",
        date: "2026-01-05",
        amount: 1_000,
        account: "sales",
      },
    );
    expect(transaction.status).toBe("draft");
  });

  it("draft残存時は締めを拒否する", async () => {
    const { store, businessId, actor } = await setupStore(1);
    await ensureFiscalPeriodForDate(store, businessId, actor, "2025-01-01");
    await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-d",
      type: "income",
      date: "2025-05-01",
      amount: 1_000,
      account: "sales",
    });
    await expect(
      closeFiscalPeriod(store, businessId, actor, "fy2025", "close-x"),
    ).rejects.toMatchObject({ code: "HAS_DRAFT_TRANSACTIONS" });
    // 締めはロールバックされ期間はopenのまま
    const period = await store.getFiscalPeriod(businessId, "fy2025");
    expect(period?.status).toBe("open");
  });

  it("同じidempotencyKeyの締め再実行はリプレイを返す", async () => {
    const { store, businessId, actor } = await seedPeriodWithData();
    await closeFiscalPeriod(store, businessId, actor, "fy2025", "close-1");
    const second = await closeFiscalPeriod(
      store,
      businessId,
      actor,
      "fy2025",
      "close-1",
    );
    expect(second.replayed).toBe(true);
    expect(second.period.status).toBe("closed");
  });
});
