// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProcessingError, AIResponseValidationError } from "./errors";
import { HeuristicAIProvider } from "./heuristic-provider";
import {
  createAIProvider,
  LLMProvider,
  type LLMCall,
} from "./llm-provider";
import { buildPrompt, sanitizeInput } from "./prompts";
import type { AIRequest } from "./provider";
import { AISuggestionService } from "./service";
import { InMemorySuggestionStore } from "./store";

const BUSINESS_ID = "biz-1";
const ACTOR = "user-1";

const REQUEST: AIRequest = {
  kind: "receipt_extraction",
  businessId: BUSINESS_ID,
  target: { type: "receipt", id: "rcpt-1" },
  input: { ocrText: "合計 1,280円 2026年10月1日 商店" },
};

function fakeCaller(output: string) {
  const calls: LLMCall[] = [];
  return {
    calls,
    caller: async (call: LLMCall) => {
      calls.push(call);
      return output;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAIProvider(プロバイダ選択)", () => {
  it("環境変数未設定時はHeuristicAIProviderにフォールバックする", () => {
    expect(createAIProvider({})).toBeInstanceOf(HeuristicAIProvider);
  });

  it("AI_LLM_PROVIDER=heuristicでもHeuristicAIProviderを返す", () => {
    expect(createAIProvider({ AI_LLM_PROVIDER: "heuristic" })).toBeInstanceOf(
      HeuristicAIProvider,
    );
  });

  it("AI_LLM_PROVIDER=openaiかつOPENAI_API_KEY設定時はLLMProviderを返す", () => {
    const provider = createAIProvider({
      AI_LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    });
    expect(provider).toBeInstanceOf(LLMProvider);
  });

  it("openai指定だがAPIキーが無い場合は警告してフォールバックする", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createAIProvider({ AI_LLM_PROVIDER: "openai" });
    expect(provider).toBeInstanceOf(HeuristicAIProvider);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("未知のプロバイダ名は警告してフォールバックする", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createAIProvider({ AI_LLM_PROVIDER: "unknown-llm" });
    expect(provider).toBeInstanceOf(HeuristicAIProvider);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("LLMProvider.generate", () => {
  it("callerのJSON出力をパースして返し、kindに応じたスキーマとプロンプトを渡す", async () => {
    const { calls, caller } = fakeCaller(
      JSON.stringify({
        amount: 1280,
        date: "2026-10-01",
        vendor: "商店",
        confidence: 0.9,
        reason: "抽出しました",
      }),
    );
    const provider = new LLMProvider({ caller, model: "test-model" });

    const result = await provider.generate(REQUEST);

    expect(result).toEqual({
      amount: 1280,
      date: "2026-10-01",
      vendor: "商店",
      confidence: 0.9,
      reason: "抽出しました",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("test-model");
    expect(calls[0].schemaName).toBe("receipt_extraction_result");
    expect(calls[0].schema.required).toContain("amount");
    expect(calls[0].input).toContain("1,280円");
    expect(calls[0].instructions.length).toBeGreaterThan(0);
  });

  it("callerが失敗した場合はprovider_errorのAIProcessingErrorに正規化する", async () => {
    const provider = new LLMProvider({
      caller: async () => {
        // SDKのエラーメッセージが証憑内容を含み得るケースを再現
        throw new Error("openai api error: receipt '合計1,280円' was rejected");
      },
      model: "m",
    });

    const err = await provider.generate(REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(AIProcessingError);
    expect((err as AIProcessingError).code).toBe("provider_error");
    expect((err as AIProcessingError).message).not.toContain("合計");
  });

  it("callerが投げたAIProcessingErrorはそのまま伝播する", async () => {
    const original = new AIProcessingError("timeout", "timed out");
    const provider = new LLMProvider({
      caller: async () => {
        throw original;
      },
      model: "m",
    });
    await expect(provider.generate(REQUEST)).rejects.toBe(original);
  });

  it("出力がJSONでない場合はinvalid_responseのAIResponseValidationErrorになる", async () => {
    const provider = new LLMProvider({
      caller: async () => "not json at all",
      model: "m",
    });
    const err = await provider.generate(REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(AIResponseValidationError);
    expect((err as AIProcessingError).code).toBe("invalid_response");
  });
});

describe("sanitizeInput(個人情報の最小送信)", () => {
  it("allowlistに無いフィールドは送信データから除去される", () => {
    const sanitized = sanitizeInput("receipt_extraction", {
      ocrText: "合計 500円",
      userName: "山田太郎",
      address: "東京都千代田区",
      memo: "私用メモ",
    });
    expect(sanitized).toEqual({ ocrText: "合計 500円" });
  });

  it("長大なOCRテキストは上限で切り詰める", () => {
    const sanitized = sanitizeInput("receipt_extraction", {
      ocrText: "あ".repeat(20_000),
    });
    expect((sanitized.ocrText as string).length).toBe(12_000);
  });

  it("重複検出では取引をid/amount/dateのみに射影し件数を制限する", () => {
    const existing = Array.from({ length: 60 }, (_, i) => ({
      id: `tx-${i}`,
      amount: 100,
      date: "2026-10-01",
      counterparty: `店舗${i}`,
      note: "補足メモ",
    }));
    const sanitized = sanitizeInput("duplicate_detection", {
      transaction: {
        id: "tx-new",
        amount: 100,
        date: "2026-10-01",
        counterparty: "店舗名",
        description: "詳細な摘要",
      },
      existingTransactions: existing,
      extraField: "削られるべき値",
    });

    expect(sanitized.transaction).toEqual({
      id: "tx-new",
      amount: 100,
      date: "2026-10-01",
    });
    const list = sanitized.existingTransactions as Record<string, unknown>[];
    expect(list).toHaveLength(50);
    expect(list[0]).toEqual({ id: "tx-0", amount: 100, date: "2026-10-01" });
    expect(sanitized.extraField).toBeUndefined();
  });

  it("月次集計は数値とyearMonthのみ送信し文字列フィールドは送らない", () => {
    const sanitized = sanitizeInput("monthly_explanation", {
      summary: {
        yearMonth: "2026-10",
        totalIncome: 300_000,
        totalExpense: 120_000,
        topVendor: "個人を特定し得る取引先名",
        breakdown: { nested: "オブジェクト" },
      },
      previousSummary: { totalExpense: 100_000 },
    });
    expect(sanitized.summary).toEqual({
      yearMonth: "2026-10",
      totalIncome: 300_000,
      totalExpense: 120_000,
    });
  });
});

describe("buildPrompt", () => {
  it("タスク文とサニタイズ済み入力を含むプロンプトを組み立てる", () => {
    const prompt = buildPrompt(REQUEST);
    expect(prompt.schemaName).toBe("receipt_extraction_result");
    expect(prompt.input).toContain("OCR");
    expect(prompt.input).toContain("1,280円");
  });
});

describe("AISuggestionServiceとの統合(auditLogs記録)", () => {
  it("LLM呼出成功時は提案がpendingになりrun_aiの監査ログが記録される", async () => {
    const { caller } = fakeCaller(
      JSON.stringify({
        amount: 1280,
        date: "2026-10-01",
        vendor: "商店",
        confidence: 0.9,
        reason: "抽出しました",
      }),
    );
    const store = new InMemorySuggestionStore();
    const service = new AISuggestionService({
      store,
      provider: new LLMProvider({ caller, model: "m" }),
    });

    const s = await service.run({
      businessId: BUSINESS_ID,
      kind: "receipt_extraction",
      target: { type: "receipt", id: "rcpt-1" },
      input: REQUEST.input,
      actorUid: ACTOR,
    });

    expect(s.status).toBe("pending");
    const logs = store.auditLogEntries(BUSINESS_ID);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("run_ai");
    expect(logs[0].targetPath).toContain("aiSuggestions");
  });

  it("LLM呼出失敗時もneeds_reviewとなり監査ログが残り再実行できる", async () => {
    const store = new InMemorySuggestionStore();
    const service = new AISuggestionService({
      store,
      provider: new LLMProvider({
        caller: async () => {
          throw new Error("api down");
        },
        model: "m",
      }),
    });

    const s = await service.run({
      businessId: BUSINESS_ID,
      kind: "receipt_extraction",
      target: { type: "receipt", id: "rcpt-1" },
      input: REQUEST.input,
      actorUid: ACTOR,
    });

    expect(s.status).toBe("needs_review");
    expect(s.lastError?.code).toBe("provider_error");
    expect(s.lastError?.message).toBe("AI provider request failed");
    expect(s.retriable).toBe(true);
    expect(store.auditLogEntries(BUSINESS_ID)[0].action).toBe("run_ai");
  });
});
