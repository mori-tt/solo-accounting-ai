import { describe, expect, it } from "vitest";
import { setupStore, seedClosedPeriod } from "../testing";
import {
  archiveReceipt,
  linkReceiptToTransaction,
  registerReceipt,
  updateReceiptMetadata,
} from "./receipts";
import { registerTransaction } from "./transactions";

const receiptInput = {
  storagePath: "receipts/biz-test/r1/receipt.pdf",
  fileName: "receipt.pdf",
  mimeType: "application/pdf",
};

async function seedReceiptAndTransaction() {
  const env = await setupStore();
  const { store, businessId, actor } = env;
  const { receipt } = await registerReceipt(store, businessId, actor, {
    id: "r1",
    ...receiptInput,
  });
  const { transaction } = await registerTransaction(store, businessId, actor, {
    idempotencyKey: "tx-r",
    type: "expense",
    date: "2025-06-10",
    amount: 5_000,
    account: "supplies",
  });
  return { ...env, receipt, transaction };
}

describe("registerReceipt / 状態管理", () => {
  it("unprocessed で登録される", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    const { receipt } = await registerReceipt(store, businessId, actor, {
      id: "r1",
      ...receiptInput,
    });
    expect(receipt.status).toBe("unprocessed");
    expect(receipt.transactionId).toBeUndefined();
  });

  it("取引に紐付けると linked になり receiptIds が更新される", async () => {
    const { store, businessId, actor, receipt, transaction } =
      await seedReceiptAndTransaction();
    const { receipt: linked } = await linkReceiptToTransaction(
      store,
      businessId,
      actor,
      receipt.id,
      transaction.id,
    );
    expect(linked.status).toBe("linked");
    expect(linked.transactionId).toBe(transaction.id);

    const txn = await store.getTransaction(businessId, transaction.id);
    expect(txn?.receiptIds).toContain(receipt.id);
  });

  it("同じ取引への再実行は冪等", async () => {
    const { store, businessId, actor, receipt, transaction } =
      await seedReceiptAndTransaction();
    await linkReceiptToTransaction(store, businessId, actor, receipt.id, transaction.id);
    const again = await linkReceiptToTransaction(
      store,
      businessId,
      actor,
      receipt.id,
      transaction.id,
    );
    expect(again.receipt.status).toBe("linked");
    const txn = await store.getTransaction(businessId, transaction.id);
    expect(txn?.receiptIds).toEqual([receipt.id]);
  });

  it("archive で取引から切り離される", async () => {
    const { store, businessId, actor, receipt, transaction } =
      await seedReceiptAndTransaction();
    await linkReceiptToTransaction(store, businessId, actor, receipt.id, transaction.id);
    const { receipt: archived } = await archiveReceipt(
      store,
      businessId,
      actor,
      receipt.id,
    );
    expect(archived.status).toBe("archived");
    expect(archived.transactionId).toBeUndefined();
    const txn = await store.getTransaction(businessId, transaction.id);
    expect(txn?.receiptIds).toEqual([]);
  });

  it("archived な証憑は紐付けできない", async () => {
    const { store, businessId, actor, receipt, transaction } =
      await seedReceiptAndTransaction();
    await archiveReceipt(store, businessId, actor, receipt.id);
    await expect(
      linkReceiptToTransaction(store, businessId, actor, receipt.id, transaction.id),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  it("締め済み期間の取引への紐付けを拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    const { transaction } = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-old",
      type: "expense",
      date: "2024-11-10",
      amount: 5_000,
      account: "supplies",
    });
    await seedClosedPeriod(store, businessId, {
      id: "fy2024",
      fiscalYear: 2024,
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });
    const { receipt } = await registerReceipt(store, businessId, actor, {
      id: "r-late",
      ...receiptInput,
    });
    await expect(
      linkReceiptToTransaction(store, businessId, actor, receipt.id, transaction.id),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
});

describe("検索要件メタデータ", () => {
  it("紐付け時に取引の日付・金額・取引先を証憑へコピーする", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    const { receipt } = await registerReceipt(store, businessId, actor, {
      id: "r1",
      ...receiptInput,
    });
    const { transaction } = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-c",
      type: "expense",
      date: "2025-06-20",
      amount: 8_800,
      account: "supplies",
      counterparty: "コピー商店",
    });
    const { receipt: linked } = await linkReceiptToTransaction(
      store,
      businessId,
      actor,
      receipt.id,
      transaction.id,
    );
    expect(linked.transactionDate).toBe("2025-06-20");
    expect(linked.amount).toBe(8_800);
    expect(linked.counterparty).toBe("コピー商店");
  });

  it("updateReceiptMetadata でメタデータを設定・上書き・クリアできる", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    const { receipt } = await registerReceipt(store, businessId, actor, {
      id: "r1",
      ...receiptInput,
    });
    const { receipt: updated } = await updateReceiptMetadata(
      store,
      businessId,
      actor,
      receipt.id,
      {
        transactionDate: "2025-06-01",
        amount: 3_400,
        counterparty: "手入力商店",
      },
    );
    expect(updated.transactionDate).toBe("2025-06-01");
    expect(updated.amount).toBe(3_400);
    expect(updated.counterparty).toBe("手入力商店");

    const { receipt: cleared } = await updateReceiptMetadata(
      store,
      businessId,
      actor,
      receipt.id,
      { counterparty: "" },
    );
    expect(cleared.transactionDate).toBeUndefined();
    expect(cleared.amount).toBeUndefined();
    expect(cleared.counterparty).toBeUndefined();
    // status や紐付けは変わらない
    expect(cleared.status).toBe("unprocessed");
  });

  it("アーカイブ済みの証憑もメタデータを更新できる", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    const { receipt } = await registerReceipt(store, businessId, actor, {
      id: "r1",
      ...receiptInput,
    });
    await archiveReceipt(store, businessId, actor, receipt.id);
    const { receipt: updated } = await updateReceiptMetadata(
      store,
      businessId,
      actor,
      receipt.id,
      { transactionDate: "2025-06-01", amount: 100 },
    );
    expect(updated.status).toBe("archived");
    expect(updated.transactionDate).toBe("2025-06-01");
  });

  it("締め済み取引に紐付く証憑のメタデータ更新を拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    const { transaction } = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "tx-2024",
      type: "expense",
      date: "2024-11-10",
      amount: 5_000,
      account: "supplies",
    });
    const { receipt } = await registerReceipt(store, businessId, actor, {
      id: "r-old",
      ...receiptInput,
    });
    await linkReceiptToTransaction(
      store,
      businessId,
      actor,
      receipt.id,
      transaction.id,
    );
    await seedClosedPeriod(store, businessId, {
      id: "fy2024",
      fiscalYear: 2024,
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });
    await expect(
      updateReceiptMetadata(store, businessId, actor, receipt.id, {
        amount: 1,
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
});
