import { describe, expect, it } from "vitest";
import { AI_CONFIDENCE_THRESHOLD } from "../suggestions";
import { setupStore } from "../testing";
import {
  approveTransactionSuggestion,
  recordReceiptSuggestion,
  recordTransactionSuggestion,
  rejectTransactionSuggestion,
  decideReceiptSuggestion,
} from "./aiSuggestions";
import { registerReceipt } from "./receipts";
import {
  confirmTransaction,
  registerTransaction,
} from "./transactions";

async function seedTransaction() {
  const env = await setupStore();
  const { store, businessId, actor } = env;
  const { transaction } = await registerTransaction(store, businessId, actor, {
    idempotencyKey: "tx-ai",
    type: "expense",
    date: "2025-06-10",
    amount: 12_000,
    account: "misc",
    counterparty: "不明",
  });
  return { ...env, transaction };
}

describe("AI提案の記録", () => {
  it("aiSuggestion として保持し確定フィールドは変えない", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    const { suggestion } = await recordTransactionSuggestion(
      store,
      businessId,
      actor,
      transaction.id,
      {
        suggested: { account: "supplies" },
        confidence: 0.92,
        rationale: "文具と推定",
        model: "test-model",
      },
    );
    expect(suggestion.status).toBe("pending");
    expect(suggestion.needsReview).toBe(false);

    const saved = await store.getTransaction(businessId, transaction.id);
    expect(saved?.aiSuggestion?.status).toBe("pending");
    expect(saved?.account).toBe("misc"); // 確定値は不変

    const logs = await store.listAuditLogs(businessId);
    expect(logs.some((l) => l.action === "ai_suggest")).toBe(true);
  });

  it("低信頼度の提案は needsReview=true", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    const { suggestion } = await recordTransactionSuggestion(
      store,
      businessId,
      actor,
      transaction.id,
      {
        suggested: { account: "rent" },
        confidence: AI_CONFIDENCE_THRESHOLD - 0.01,
      },
    );
    expect(suggestion.needsReview).toBe(true);
  });

  it("confidence が 0-1 の範囲外・空の提案は拒否", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    await expect(
      recordTransactionSuggestion(store, businessId, actor, transaction.id, {
        suggested: { account: "x" },
        confidence: 1.5,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SUGGESTION" });
    await expect(
      recordTransactionSuggestion(store, businessId, actor, transaction.id, {
        suggested: {},
        confidence: 0.5,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SUGGESTION" });
  });
});

describe("AI提案の採用(approve)", () => {
  it("提案値を確定フィールドへコピーするが draft のまま", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    await recordTransactionSuggestion(store, businessId, actor, transaction.id, {
      suggested: { account: "supplies", amount: 15_000 },
      confidence: 0.9,
    });
    const { transaction: approved } = await approveTransactionSuggestion(
      store,
      businessId,
      actor,
      transaction.id,
    );
    expect(approved.account).toBe("supplies");
    expect(approved.amount).toBe(15_000);
    // 採用しても確定ではない。confirmed は別途ユーザーの確定操作が必要
    expect(approved.status).toBe("draft");
    expect(approved.aiSuggestion?.status).toBe("approved");
    expect(approved.aiSuggestion?.decidedBy).toBe(actor.uid);

    const logs = await store.listAuditLogs(businessId);
    expect(logs.some((l) => l.action === "approve_ai")).toBe(true);
  });

  it("適用フィールドを限定できる・禁止フィールドは拒否", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    await recordTransactionSuggestion(store, businessId, actor, transaction.id, {
      suggested: { account: "supplies", amount: 99_999 },
      confidence: 0.9,
    });
    const { transaction: approved } = await approveTransactionSuggestion(
      store,
      businessId,
      actor,
      transaction.id,
      ["account"],
    );
    expect(approved.account).toBe("supplies");
    expect(approved.amount).toBe(12_000); // 未適用
  });

  it("approved への再実行は冪等、approved 後の reject は拒否", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    await recordTransactionSuggestion(store, businessId, actor, transaction.id, {
      suggested: { account: "supplies" },
      confidence: 0.9,
    });
    await approveTransactionSuggestion(store, businessId, actor, transaction.id);
    const again = await approveTransactionSuggestion(
      store,
      businessId,
      actor,
      transaction.id,
    );
    expect(again.transaction.aiSuggestion?.status).toBe("approved");
    await expect(
      rejectTransactionSuggestion(store, businessId, actor, transaction.id),
    ).rejects.toMatchObject({ code: "SUGGESTION_NOT_PENDING" });
  });
});

describe("AI提案の拒否(reject)", () => {
  it("確定フィールドを変更せず status を rejected にする", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    await recordTransactionSuggestion(store, businessId, actor, transaction.id, {
      suggested: { account: "supplies" },
      confidence: 0.9,
    });
    const { transaction: rejected } = await rejectTransactionSuggestion(
      store,
      businessId,
      actor,
      transaction.id,
    );
    expect(rejected.aiSuggestion?.status).toBe("rejected");
    expect(rejected.account).toBe("misc");
    expect(rejected.status).toBe("draft");

    const logs = await store.listAuditLogs(businessId);
    expect(logs.some((l) => l.action === "reject_ai")).toBe(true);
  });

  it("拒否後の approve はエラー", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    await recordTransactionSuggestion(store, businessId, actor, transaction.id, {
      suggested: { account: "supplies" },
      confidence: 0.9,
    });
    await rejectTransactionSuggestion(store, businessId, actor, transaction.id);
    await expect(
      approveTransactionSuggestion(store, businessId, actor, transaction.id),
    ).rejects.toMatchObject({ code: "SUGGESTION_NOT_PENDING" });
  });

  it("提案が無い取引の approve/reject は SUGGESTION_NOT_FOUND", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    await expect(
      approveTransactionSuggestion(store, businessId, actor, transaction.id),
    ).rejects.toMatchObject({ code: "SUGGESTION_NOT_FOUND" });
    await expect(
      rejectTransactionSuggestion(store, businessId, actor, transaction.id),
    ).rejects.toMatchObject({ code: "SUGGESTION_NOT_FOUND" });
  });
});

describe("証憑のAI提案", () => {
  it("記録・採用・拒否ができる", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    const { receipt } = await registerReceipt(store, businessId, actor, {
      id: "r-ai",
      storagePath: "receipts/biz/r-ai/a.pdf",
      fileName: "a.pdf",
      mimeType: "application/pdf",
    });
    await recordReceiptSuggestion(store, businessId, actor, receipt.id, {
      suggested: { amount: 3_000, date: "2025-06-01", counterparty: "駅ビル" },
      confidence: 0.5,
    });
    const saved = await store.getReceipt(businessId, receipt.id);
    expect(saved?.aiSuggestion?.needsReview).toBe(true);

    const { receipt: approved } = await decideReceiptSuggestion(
      store,
      businessId,
      actor,
      receipt.id,
      "approved",
    );
    expect(approved.aiSuggestion?.status).toBe("approved");
    // 採用しても取引は自動作成されない
    expect(approved.transactionId).toBeUndefined();
  });
});

describe("確定・締めとの関係", () => {
  it("提案の記録だけでは confirmed にならない", async () => {
    const { store, businessId, actor, transaction } = await seedTransaction();
    await recordTransactionSuggestion(store, businessId, actor, transaction.id, {
      suggested: { account: "supplies" },
      confidence: 0.99,
    });
    await approveTransactionSuggestion(store, businessId, actor, transaction.id);
    const saved = await store.getTransaction(businessId, transaction.id);
    expect(saved?.status).toBe("draft");
    // ユーザーが明示的に確定操作をすると confirmed
    const { transaction: confirmed } = await confirmTransaction(
      store,
      businessId,
      actor,
      transaction.id,
    );
    expect(confirmed.status).toBe("confirmed");
  });
});
