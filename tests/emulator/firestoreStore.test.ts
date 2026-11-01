import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { FirestoreAccountingStore } from "../../src/lib/accounting/store/firestore";
import { registerBusiness } from "../../src/lib/accounting/services/business";
import {
  confirmTransaction,
  registerTransaction,
} from "../../src/lib/accounting/services/transactions";
import { testActor } from "../../src/lib/accounting/testing";

/**
 * Firestore Emulator 経由のstore実装テスト。
 * `pnpm test:emulators`(firebase emulators:exec)でのみ実行され、
 * FIRESTORE_EMULATOR_HOST 未設定の通常の `pnpm test` ではスキップされる。
 */
const emulator = process.env.FIRESTORE_EMULATOR_HOST !== undefined;
const PROJECT_ID = "demo-solo-accounting-ai";

describe.skipIf(!emulator)("FirestoreAccountingStore (emulator)", () => {
  let store: FirestoreAccountingStore;
  const businessId = "biz-emu";

  beforeAll(async () => {
    const app =
      getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
    store = new FirestoreAccountingStore(getFirestore(app));
    // Emulatorデータをクリア
    await fetch(
      `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: "DELETE" },
    );
  });

  it("Business / Transaction を往復できる(*AtはTimestamp変換される)", async () => {
    const actor = testActor("2025-06-15T12:00:00.000Z");
    const { business } = await registerBusiness(store, actor, {
      id: businessId,
      name: "エミュレータ事業",
      ownerUid: actor.uid,
      fiscalYearStartMonth: 4,
      taxMode: "standard",
    });
    expect(business.id).toBe(businessId);

    const saved = await store.getBusiness(businessId);
    expect(saved?.fiscalYearStartMonth).toBe(4);
    expect(saved?.createdAt).toBe("2025-06-15T12:00:00.000Z");

    const { transaction } = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "emu-tx-1",
      type: "expense",
      date: "2025-06-10",
      amount: 12_000,
      account: "supplies",
      counterparty: "文具店",
    });
    const savedTx = await store.getTransaction(businessId, transaction.id);
    expect(savedTx?.status).toBe("draft");
    expect(savedTx?.date).toBe("2025-06-10"); // YYYY-MM-DDのまま
    expect(savedTx?.amount).toBe(12_000);
  });

  it("冪等キーのリプレイはサーバー側でも二重登録しない", async () => {
    const actor = testActor();
    const a = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "emu-tx-dup",
      type: "income",
      date: "2025-06-01",
      amount: 1_000,
      account: "sales",
    });
    const b = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "emu-tx-dup",
      type: "income",
      date: "2025-06-01",
      amount: 999_999,
      account: "sales",
    });
    expect(b.replayed).toBe(true);
    expect(b.transaction.id).toBe(a.transaction.id);
    expect(b.transaction.amount).toBe(1_000);
  });

  it("トランザクション内読み取りと監査ログが一貫してコミットされる", async () => {
    const actor = testActor();
    const { transaction } = await registerTransaction(store, businessId, actor, {
      idempotencyKey: "emu-tx-c",
      type: "income",
      date: "2025-06-05",
      amount: 3_000,
      account: "sales",
    });
    const { transaction: confirmed } = await confirmTransaction(
      store,
      businessId,
      actor,
      transaction.id,
    );
    expect(confirmed.status).toBe("confirmed");

    const logs = await store.listAuditLogs(businessId);
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("create");
    expect(actions).toContain("update");
    const targetPaths = logs.map((l) => l.targetPath);
    expect(targetPaths).toContain(
      `businesses/${businessId}/transactions/${transaction.id}`,
    );
  });

  it("期間内クエリ(listTransactionsInRange)が日付文字列で範囲検索できる", async () => {
    const txns = await store.listTransactionsInRange(
      businessId,
      "2025-06-01",
      "2025-06-30",
    );
    // emu-tx-1 / emu-tx-dup / emu-tx-c の3件
    expect(txns).toHaveLength(3);
    expect(txns.every((t) => t.date.startsWith("2025-06"))).toBe(true);
    const none = await store.listTransactionsInRange(
      businessId,
      "2025-07-01",
      "2025-07-31",
    );
    expect(none).toHaveLength(0);
  });
});
