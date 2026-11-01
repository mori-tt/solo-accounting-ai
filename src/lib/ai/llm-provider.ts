import OpenAI from "openai";
import { AIProcessingError, AIResponseValidationError } from "./errors";
import { HeuristicAIProvider } from "./heuristic-provider";
import type { AIProvider, AIRequest } from "./provider";
import { buildPrompt } from "./prompts";

/**
 * 実LLMプロバイダ(OpenAI Responses API)とプロバイダ選択のファクトリ。
 * サーバーサイド専用: APIキーはNEXT_PUBLIC_ではない環境変数からのみ読み、
 * ブラウザ環境での実行を検知した場合は例外を投げる。
 * 入力内容・出力内容・SDKのエラーメッセージはログに出力しない
 * (証憑内容・個人情報を含み得るため)。
 */

export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

/** LLMへの1回のJSON生成呼び出し */
export interface LLMCall {
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

/**
 * LLM呼び出しの最小抽象化。戻り値はモデルが生成したJSONテキスト。
 * テストではSDKを介さない偽のcallerを注入できる。
 */
export type LLMCaller = (call: LLMCall) => Promise<string>;

export interface LLMProviderDeps {
  caller: LLMCaller;
  model: string;
}

/**
 * LLMをバックエンドに持つAIProvider。
 * 入力はkindごとのallowlistで最小化(prompts.ts)し、JSON Schemaによる
 * Structured Outputsで出力をJSONに限定する。形の最終検証はschemas.ts側。
 */
export class LLMProvider implements AIProvider {
  private readonly caller: LLMCaller;
  private readonly model: string;

  constructor(deps: LLMProviderDeps) {
    this.caller = deps.caller;
    this.model = deps.model;
  }

  async generate(request: AIRequest): Promise<unknown> {
    const prompt = buildPrompt(request);
    let text: string;
    try {
      text = await this.caller({
        model: this.model,
        instructions: prompt.instructions,
        input: prompt.input,
        schemaName: prompt.schemaName,
        schema: prompt.schema,
      });
    } catch (error) {
      if (error instanceof AIProcessingError) throw error;
      // SDKのエラーメッセージは入力内容を含み得るため固定文言に置き換える
      throw new AIProcessingError(
        "provider_error",
        "AI provider request failed",
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new AIResponseValidationError("AI response was not valid JSON");
    }
  }
}

/**
 * OpenAI公式SDK(Responses API)を使うLLMCallerを作る。サーバーサイド専用。
 * `store: false` でOpenAI側にレスポンスを保存させない(個人情報の外部保持を最小化)。
 */
export function createOpenAICaller(client: OpenAI): LLMCaller {
  return async (call) => {
    assertServerSide();
    const response = await client.responses.create({
      model: call.model,
      instructions: call.instructions,
      input: call.input,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: call.schemaName,
          schema: call.schema,
          strict: true,
        },
      },
    });
    return response.output_text;
  };
}

/**
 * 環境変数からAIProviderを構築する。サーバーサイド専用。
 *
 * - `AI_LLM_PROVIDER=openai` かつ `OPENAI_API_KEY` 設定時:
 *   OpenAI Responses APIを使うLLMProvider
 *   (モデルは `OPENAI_MODEL`、省略時 DEFAULT_OPENAI_MODEL)
 * - 未設定・`heuristic`・未知の値・APIキー欠落時:
 *   HeuristicAIProvider にフォールバック
 *   (AIプロバイダ未設定でも本体機能を妨げない)
 *
 * AI呼び出しの監査記録(run_ai等)はAISuggestionServiceがauditLogsへ書き込む。
 */
export function createAIProvider(
  env: Record<string, string | undefined> = process.env,
): AIProvider {
  assertServerSide();
  const name = env.AI_LLM_PROVIDER;
  if (!name || name === "heuristic") {
    return new HeuristicAIProvider();
  }
  if (name !== "openai") {
    // 設定値のみを通知し、入力データや鍵は含めない
    console.warn(
      "[ai] unknown AI_LLM_PROVIDER; falling back to heuristic provider",
    );
    return new HeuristicAIProvider();
  }
  if (!env.OPENAI_API_KEY) {
    console.warn(
      "[ai] AI_LLM_PROVIDER=openai but OPENAI_API_KEY is not set; falling back to heuristic provider",
    );
    return new HeuristicAIProvider();
  }
  return new LLMProvider({
    caller: createOpenAICaller(new OpenAI({ apiKey: env.OPENAI_API_KEY })),
    model: env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
  });
}

function assertServerSide(): void {
  if (typeof window !== "undefined") {
    throw new Error("AI provider must only run on the server");
  }
}
