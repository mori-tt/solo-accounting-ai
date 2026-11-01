import { describe, expect, it } from "vitest";
import type { AIProvider } from "./provider";
import { AISuggestionService } from "./service";
import { InMemorySuggestionStore } from "./store";
import type { SuggestionKind } from "./types";

const BUSINESS_ID = "biz-1";
const ACTOR = "user-1";

function providerReturning(raw: unknown): AIProvider {
  return { generate: async () => raw };
}

function delayedProvider(raw: unknown, delayMs: number): AIProvider {
  return {
    generate: () => new Promise((resolve) => setTimeout(() => resolve(raw), delayMs)),
  };
}

function makeService(
  provider: AIProvider,
  store = new InMemorySuggestionStore(),
  timeoutMs = 50,
) {
  return {
    store,
    service: new AISuggestionService({ store, provider, timeoutMs }),
  };
}

function runReceipt(
  service: AISuggestionService,
  input: Record<string, unknown> = {},
) {
  return service.run({
    businessId: BUSINESS_ID,
    kind: "receipt_extraction",
    target: { type: "receipt", id: "rcpt-1" },
    input,
    actorUid: ACTOR,
  });
}

const FULL_RECEIPT = {
  amount: 1280,
  date: "2026-10-01",
  vendor: "商店",
  confidence: 0.9,
  reason: "OCRから抽出",
};

describe("receipt_extraction の判断不能ケース", () => {
  it("金額が読み取れない場合はneeds_reviewになりissuesに記録される", async () => {
    const { service } = makeService(
      providerReturning({ date: "2026-10-01", vendor: "商店" }),
    );
    const s = await runReceipt(service);

    expect(s.status).toBe("needs_review");
    expect(s.issues).toContain("amount_unreadable");
    expect(s.payload).toEqual({
      amount: null,
      date: "2026-10-01",
      vendor: "商店",
    });
    expect(s.retriable).toBe(true);
    expect(s.reason.length).toBeGreaterThan(0);
  });

  it("日付が読み取れない場合はneeds_reviewになる", async () => {
    const { service } = makeService(
      providerReturning({ amount: 500, vendor: "商店" }),
    );
    const s = await runReceipt(service);

    expect(s.status).toBe("needs_review");
    expect(s.issues).toContain("date_unreadable");
  });

  it("店名が不明な場合はneeds_reviewになる", async () => {
    const { service } = makeService(
      providerReturning({ amount: 500, date: "2026-10-01" }),
    );
    const s = await runReceipt(service);

    expect(s.status).toBe("needs_review");
    expect(s.issues).toContain("vendor_unknown");
  });

  it("全項目読み取れた場合はpendingになりconfidenceとreasonが保存される", async () => {
    const { service } = makeService(providerReturning(FULL_RECEIPT));
    const s = await runReceipt(service);

    expect(s.status).toBe("pending");
    expect(s.confidence).toBe(0.9);
    expect(s.reason).toBe("OCRから抽出");
    expect(s.issues).toEqual([]);
  });
});

describe("duplicate_detection", () => {
  it("重複候補がある場合は候補を含む提案がpendingになる", async () => {
    const { service } = makeService(
      providerReturning({
        candidates: [
          {
            transactionId: "tx-9",
            score: 0.85,
            reason: "金額と日付が一致",
          },
        ],
        confidence: 0.85,
        reason: "既存取引と一致",
      }),
    );
    const s = await service.run({
      businessId: BUSINESS_ID,
      kind: "duplicate_detection",
      target: { type: "transaction", id: "tx-1" },
      input: {},
      actorUid: ACTOR,
    });

    expect(s.status).toBe("pending");
    expect(s.payload).toEqual({
      candidates: [
        { transactionId: "tx-9", score: 0.85, reason: "金額と日付が一致" },
      ],
    });
  });
});

describe("ユーザーの判断操作", () => {
  it("ユーザーが拒否するとrejectedになり理由と監査ログが保存される", async () => {
    const { service, store } = makeService(providerReturning(FULL_RECEIPT));
    const s = await runReceipt(service);

    const rejected = await service.reject(
      BUSINESS_ID,
      s.id,
      ACTOR,
      "金額が実際と異なるため",
    );

    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectReason).toBe("金額が実際と異なるため");
    expect(rejected.decidedBy).toBe(ACTOR);
    expect(rejected.retriable).toBe(false);

    const logs = store.auditLogEntries(BUSINESS_ID);
    expect(logs.some((l) => l.action === "reject_ai")).toBe(true);
  });

  it("acceptしても確定データは変更されず、提案の状態だけがacceptedになる", async () => {
    const { service, store } = makeService(providerReturning(FULL_RECEIPT));
    const s = await runReceipt(service);

    const accepted = await service.accept(BUSINESS_ID, s.id, ACTOR);

    expect(accepted.status).toBe("accepted");
    const logs = store.auditLogEntries(BUSINESS_ID);
    expect(logs.some((l) => l.action === "approve_ai")).toBe(true);
  });

  it("拒否済みの提案は再実行できない", async () => {
    const { service } = makeService(providerReturning(FULL_RECEIPT));
    const s = await runReceipt(service);
    await service.reject(BUSINESS_ID, s.id, ACTOR);

    await expect(
      service.retry(BUSINESS_ID, s.id, ACTOR, {}),
    ).rejects.toThrow(/cannot be retried/);
  });
});

describe("AI処理の失敗と再実行", () => {
  it("タイムアウトした場合はneeds_reviewになりlastErrorが記録され再実行できる", async () => {
    const store = new InMemorySuggestionStore();
    const { service } = makeService(
      delayedProvider(FULL_RECEIPT, 1_000),
      store,
      20,
    );
    const s = await runReceipt(service);

    expect(s.status).toBe("needs_review");
    expect(s.lastError?.code).toBe("timeout");
    expect(s.retriable).toBe(true);
    expect(s.attempts).toBe(1);

    // 再実行: 正常に応答するプロバイダに差し替え
    const retried = await service.retry(BUSINESS_ID, s.id, ACTOR, {});
    expect(retried.status).toBe("needs_review"); // 同じプロバイダなので再度タイムアウト
    expect(retried.attempts).toBe(2);
    expect(retried.lastError?.code).toBe("timeout");

    // 応答するプロバイダで再実行すると成功する
    const recovered = new AISuggestionService({
      store,
      provider: providerReturning(FULL_RECEIPT),
      timeoutMs: 1_000,
    });
    const ok = await recovered.retry(BUSINESS_ID, s.id, ACTOR, {});
    expect(ok.status).toBe("pending");
    expect(ok.lastError).toBeNull();
    expect(ok.attempts).toBe(3);
  });

  it("AIレスポンスが不正な場合はneeds_review(invalid_response)になり再実行できる", async () => {
    const store = new InMemorySuggestionStore();
    const { service } = makeService(providerReturning("<html>error</html>"), store);
    const s = await runReceipt(service);

    expect(s.status).toBe("needs_review");
    expect(s.lastError?.code).toBe("invalid_response");
    expect(s.issues).toContain("invalid_response");
    expect(s.retriable).toBe(true);

    const recovered = new AISuggestionService({
      store,
      provider: providerReturning(FULL_RECEIPT),
    });
    const ok = await recovered.retry(BUSINESS_ID, s.id, ACTOR, {});
    expect(ok.status).toBe("pending");
    expect(ok.payload).toEqual({
      amount: 1280,
      date: "2026-10-01",
      vendor: "商店",
    });
  });

  it("プロバイダが例外を投げた場合はneeds_review(provider_error)になる", async () => {
    const failing: AIProvider = {
      generate: async () => {
        throw new Error("vendor internal error with receipt content xyz");
      },
    };
    const { service } = makeService(failing);
    const s = await runReceipt(service);

    expect(s.status).toBe("needs_review");
    expect(s.lastError?.code).toBe("provider_error");
    // プロバイダの生メッセージ(証憑内容を含み得る)をそのまま保存しない
    expect(s.lastError?.message).toBe("AI provider request failed");
  });
});

describe("その他のkind", () => {
  it.each<SuggestionKind>([
    "account_suggestion",
    "transaction_description",
    "monthly_explanation",
  ])("%s の提案が作成される", async (kind) => {
    const responses: Record<string, unknown> = {
      account_suggestion: {
        candidates: [
          { account: "travel", confidence: 0.7, reason: "交通費らしい" },
        ],
      },
      transaction_description: { description: "交通費の支払い" },
      monthly_explanation: { explanation: "支出が前月より増加", highlights: [] },
    };
    const { service } = makeService(providerReturning(responses[kind]));
    const s = await service.run({
      businessId: BUSINESS_ID,
      kind,
      target: { type: "transaction", id: "tx-1" },
      input: {},
      actorUid: ACTOR,
    });
    expect(s.status).toBe("pending");
    expect(s.reason.length).toBeGreaterThan(0);
    expect(s.confidence).toBeGreaterThanOrEqual(0);
  });
});
