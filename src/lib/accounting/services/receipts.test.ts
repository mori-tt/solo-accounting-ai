import { describe, expect, it } from "vitest";
import { setupStore, seedClosedPeriod } from "../testing";
import {
  archiveReceipt,
  linkReceiptToTransaction,
  registerReceipt,
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
