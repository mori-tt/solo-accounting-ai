import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { setupStore, testActor } from "../testing";
import {
  confirmTransaction,
  registerTransaction,
} from "./transactions";

const base = {
  type: "income" as const,
  date: "2025-06-10",
  amount: 50_000,
  account: "sales",
  counterparty: "株式会社テスト",
  description: "開発費",
};

describe("registerTransaction", () => {
  it("draft として登録される", async () => {
    const { store, businessId, actor } = await setupStore();
    const { transaction, replayed } = await registerTransaction(
      store,
      businessId,
      actor,
      { idempotencyKey: "tx-1", ...base },
    );
    expect(replayed).toBe(false);
    expect(transaction.status).toBe("draft");
    expect(transaction.amount).toBe(50_000);
    expect(transaction.createdBy).toBe(actor.uid);

    const saved = await store.getTransaction(businessId, transaction.id);
    expect(saved?.status).toBe("draft");
  });

  it("0円を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      registerTransaction(store, businessId, actor, {
        idempotencyKey: "tx-zero",
        ...base,
        amount: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("負の金額を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      registerTransaction(store, businessId, actor, {
        idempotencyKey: "tx-neg",
        ...base,
        amount: -10_000,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("小数・非整数を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      registerTransaction(store, businessId, actor, {
        idempotencyKey: "tx-frac",
        ...base,
        amount: 1000.5,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("不正な日付を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      registerTransaction(store, businessId, actor, {
        idempotencyKey: "tx-baddate",
        ...base,
        date: "2025-02-30",
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATE" });
  });

  it("監査ログが記録される(内容スナップショットなし)", async () => {
    const { store, businessId, actor } = await setupStore();
    const { transaction } = await registerTransaction(
      store,
      businessId,
      actor,
      { idempotencyKey: "tx-audit", ...base },
    );
    const logs = await store.listAuditLogs(businessId);
    const entry = logs.find(
      (l) => l.targetPath === `businesses/${businessId}/transactions/${transaction.id}`,
    );
    expect(entry).toBeDefined();
    expect(entry?.action).toBe("create");
    expect(entry?.actorUid).toBe(actor.uid);
    expect(entry).not.toHaveProperty("amount");
    expect(entry).not.toHaveProperty("counterparty");
  });

  it("同じ idempotencyKey の再実行は二重登録しない", async () => {
    const { store, businessId, actor } = await setupStore();
    const first = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-dup",
      ...base,
    });
    const second = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-dup",
      ...base,
      amount: 99_999, // リトライでペイロードが変わっても既存を返す
    });
    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.transaction.amount).toBe(50_000);

    const logs = await store.listAuditLogs(businessId);
    const creates = logs.filter(
      (l) => l.action === "create" && l.targetPath.includes("/transactions/"),
    );
    expect(creates).toHaveLength(1);
  });

  it("別キーなら別の取引として登録される", async () => {
    const { store, businessId, actor } = await setupStore();
    const a = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-a",
      ...base,
    });
    const b = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-b",
      ...base,
    });
    expect(a.transaction.id).not.toBe(b.transaction.id);
  });
});

describe("confirmTransaction", () => {
  it("draft を confirmed にする", async () => {
    const { store, businessId, actor } = await setupStore();
    const { transaction } = await registerTransaction(
      store,
      businessId,
      actor,
      { idempotencyKey: "tx-c1", ...base },
    );
    const { transaction: confirmed } = await confirmTransaction(
      store,
      businessId,
      actor,
      transaction.id,
    );
    expect(confirmed.status).toBe("confirmed");
  });

  it("confirmed への再実行は冪等に成功する", async () => {
    const { store, businessId, actor } = await setupStore();
    const { transaction } = await registerTransaction(
      store,
      businessId,
      actor,
      { idempotencyKey: "tx-c2", ...base },
    );
    await confirmTransaction(store, businessId, actor, transaction.id);
    const again = await confirmTransaction(
      store,
      businessId,
      actor,
      transaction.id,
    );
    expect(again.transaction.status).toBe("confirmed");
  });

  it("存在しない取引は NOT_FOUND", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      confirmTransaction(store, businessId, actor, "missing"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("締め済み期間の保護", () => {
  it("closed期間の日付への登録を拒否する", async () => {
    const store = new MemoryStore();
    const actor = testActor();
    await store.transact("biz1", {}, async () => ({
      batch: {
        puts: [
          {
            collection: "fiscalPeriods",
            id: "fy2024",
            data: {
              id: "fy2024",
              fiscalYear: 2024,
              startDate: "2024-01-01",
              endDate: "2024-12-31",
              status: "closed",
            },
          },
        ],
        audits: [],
      },
      value: undefined,
    }));
    await expect(
      registerTransaction(store, "biz1", actor, {
        idempotencyKey: "tx-closed",
        ...base,
        date: "2024-12-31",
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    // 期間外なら登録できる
    const ok = await registerTransaction(store, "biz1", actor, {
      idempotencyKey: "tx-open",
      ...base,
      date: "2025-01-01",
    });
    expect(ok.transaction.status).toBe("draft");
  });
});
