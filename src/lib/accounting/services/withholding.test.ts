import { describe, expect, it } from "vitest";
import { setupStore, testActor } from "../testing";
import { registerExpense } from "./expenses";
import { registerTransaction } from "./transactions";
import {
  planWithholdingRecord,
  resolveWithholdingTaxAmount,
} from "./withholding";

const expenseBase = {
  type: "expense" as const,
  date: "2025-06-10",
  amount: 100_000,
  account: "outsourcing",
  counterparty: "外注先A",
};

describe("resolveWithholdingTaxAmount", () => {
  it("auto は区分の税率で税額を確定する", () => {
    expect(
      resolveWithholdingTaxAmount({
        category: "service_fee",
        paymentAmount: 100_000,
        calculation: "auto",
      }),
    ).toBe(10_210);
  });

  it("manual は入力税額をそのまま使う", () => {
    expect(
      resolveWithholdingTaxAmount({
        category: "salary",
        paymentAmount: 80_000,
        calculation: "manual",
        taxAmount: 0,
      }),
    ).toBe(0);
  });

  it("manual で税額未指定は拒否する", () => {
    expect(() =>
      resolveWithholdingTaxAmount({
        category: "service_fee",
        paymentAmount: 100_000,
        calculation: "manual",
      }),
    ).toThrow(/taxAmount is required/);
  });

  it("税額が対象支払額を超えると拒否する", () => {
    expect(() =>
      resolveWithholdingTaxAmount({
        category: "service_fee",
        paymentAmount: 100_000,
        calculation: "manual",
        taxAmount: 100_001,
      }),
    ).toThrow(/must not exceed paymentAmount/);
  });

  it("給与のautoは拒否する(税額表依存のため自動計算不可)", () => {
    expect(() =>
      resolveWithholdingTaxAmount({
        category: "salary",
        paymentAmount: 100_000,
        calculation: "auto",
      }),
    ).toThrow();
  });
});

describe("planWithholdingRecord", () => {
  const actor = testActor();
  const at = "2025-06-15T12:00:00.000Z";
  const tx = { id: "tx-1", type: "expense" as const, amount: 100_000 };

  it("取引IDをレコードIDに使い、作成者・時刻を保持する", () => {
    const record = planWithholdingRecord(
      tx,
      {
        category: "service_fee",
        paymentAmount: 100_000,
        calculation: "auto",
        note: "原稿料",
      },
      actor,
      at,
    );
    expect(record.id).toBe("tx-1");
    expect(record.transactionId).toBe("tx-1");
    expect(record.taxAmount).toBe(10_210);
    expect(record.calculation).toBe("auto");
    expect(record.note).toBe("原稿料");
    expect(record.createdBy).toBe(actor.uid);
  });

  it("expense以外の取引は拒否する", () => {
    expect(() =>
      planWithholdingRecord(
        { ...tx, type: "income" },
        {
          category: "service_fee",
          paymentAmount: 100_000,
          calculation: "auto",
        },
        actor,
        at,
      ),
    ).toThrow(/expense transactions/);
  });

  it("対象支払額が取引額を超えると拒否する", () => {
    expect(() =>
      planWithholdingRecord(
        tx,
        {
          category: "service_fee",
          paymentAmount: 100_001,
          calculation: "auto",
        },
        actor,
        at,
      ),
    ).toThrow(/must not exceed the transaction amount/);
  });

  it("既存レコードのcreatedBy/createdAtを引き継ぐ", () => {
    const first = planWithholdingRecord(
      tx,
      {
        category: "service_fee",
        paymentAmount: 100_000,
        calculation: "auto",
      },
      actor,
      "2025-01-01T00:00:00.000Z",
    );
    const next = planWithholdingRecord(
      tx,
      {
        category: "service_fee",
        paymentAmount: 90_000,
        calculation: "manual",
        taxAmount: 5_000,
      },
      { uid: "other-uid", at: "2025-02-01T00:00:00.000Z" },
      "2025-02-01T00:00:00.000Z",
      first,
    );
    expect(next.createdBy).toBe(first.createdBy);
    expect(next.createdAt).toBe(first.createdAt);
    expect(next.taxAmount).toBe(5_000);
    expect(next.updatedAt).toBe("2025-02-01T00:00:00.000Z");
  });
});

describe("registerTransaction の源泉徴収連携", () => {
  it("withholding指定で取引と同一コミットで記録する", async () => {
    const { store, businessId, actor } = await setupStore();
    const { transaction } = await registerTransaction(
      store,
      businessId,
      actor,
      {
        idempotencyKey: "tx-wh-1",
        ...expenseBase,
        withholding: {
          category: "service_fee",
          paymentAmount: 100_000,
          calculation: "auto",
        },
      },
    );
    const record = await store.getWithholdingRecord(
      businessId,
      transaction.id,
    );
    expect(record).toBeDefined();
    expect(record?.taxAmount).toBe(10_210);
    expect(record?.category).toBe("service_fee");

    // 取引・記録それぞれに監査ログが残る
    const logs = await store.listAuditLogs(businessId);
    expect(
      logs.some(
        (l) =>
          l.targetPath ===
          `businesses/${businessId}/withholdingRecords/${transaction.id}`,
      ),
    ).toBe(true);
  });

  it("withholding未指定なら記録を作らない", async () => {
    const { store, businessId, actor } = await setupStore();
    const { transaction } = await registerTransaction(
      store,
      businessId,
      actor,
      { idempotencyKey: "tx-wh-2", ...expenseBase },
    );
    expect(
      await store.getWithholdingRecord(businessId, transaction.id),
    ).toBeUndefined();
  });

  it("収入取引への源泉徴収設定は拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      registerTransaction(store, businessId, actor, {
        idempotencyKey: "tx-wh-3",
        type: "income",
        date: "2025-06-10",
        amount: 100_000,
        account: "sales",
        withholding: {
          category: "service_fee",
          paymentAmount: 100_000,
          calculation: "auto",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("registerExpense の源泉徴収連携", () => {
  it("withholding指定で経費・取引・記録を同一コミットする", async () => {
    const { store, businessId, actor } = await setupStore();
    const { transaction } = await registerExpense(store, businessId, actor, {
      idempotencyKey: "ex-wh-1",
      date: "2025-06-10",
      amount: 100_000,
      account: "outsourcing",
      counterparty: "外注先A",
      taxCategory: "taxable",
      withholding: {
        category: "service_fee",
        paymentAmount: 100_000,
        calculation: "manual",
        taxAmount: 10_210,
      },
    });
    const record = await store.getWithholdingRecord(
      businessId,
      transaction.id,
    );
    expect(record?.calculation).toBe("manual");
    expect(record?.taxAmount).toBe(10_210);
  });
});
