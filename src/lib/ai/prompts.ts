import type { AIRequest } from "./provider";
import type { SuggestionKind } from "./types";

/**
 * LLMへのプロンプト構築と入力サニタイズ。
 * docs/AI_POLICY.md「処理に必要な最小限のデータのみを渡す」に従い、
 * kindごとに必要なフィールドだけを抽出して外部APIへ送信する。
 * ここで生成する文字列には証憑内容が含まれ得るため、ログへは出力しないこと。
 */

// トークン量・個人情報の送信量を抑えるための上限
const MAX_TEXT_CHARS = 2_000;
const MAX_OCR_TEXT_CHARS = 12_000;
const MAX_ACCOUNT_CANDIDATES = 100;
const MAX_EXISTING_TRANSACTIONS = 50;

/** LLMへ渡す構築済みプロンプト */
export interface BuiltPrompt {
  /** モデルの振る舞いを定める上位指示(Responses APIのinstructions相当) */
  instructions: string;
  /** タスク文 + サニタイズ済み入力データ(JSON) */
  input: string;
  /** Structured Outputs用の出力スキーマ名 */
  schemaName: string;
  /** Structured Outputs(strict)用のJSON Schema */
  schema: Record<string, unknown>;
}

/**
 * 外部APIへ送信する入力をkindごとの必要最小限の形に整形する。
 * allowlistに無いフィールド(氏名・住所・メモ等の個人情報を含み得る)は捨てる。
 */
export function sanitizeInput(
  kind: SuggestionKind,
  input: Record<string, unknown>,
): Record<string, unknown> {
  switch (kind) {
    case "receipt_extraction":
      return { ocrText: asText(input.ocrText, MAX_OCR_TEXT_CHARS) ?? "" };
    case "account_suggestion": {
      const out = pickText(input, ["counterparty", "description", "date"]);
      const amount = asNumber(input.amount);
      if (amount !== undefined) out.amount = amount;
      const candidates = input.accountCandidates;
      if (Array.isArray(candidates)) {
        const codes = candidates
          .filter((c): c is string => typeof c === "string")
          .slice(0, MAX_ACCOUNT_CANDIDATES);
        if (codes.length > 0) out.accountCandidates = codes;
      }
      return out;
    }
    case "duplicate_detection":
      return {
        transaction: projectTransaction(input.transaction),
        existingTransactions: (Array.isArray(input.existingTransactions)
          ? input.existingTransactions
          : []
        )
          .slice(0, MAX_EXISTING_TRANSACTIONS)
          .map(projectTransaction),
      };
    case "transaction_description": {
      const out = pickText(input, ["counterparty", "date", "type"]);
      const amount = asNumber(input.amount);
      if (amount !== undefined) out.amount = amount;
      return out;
    }
    case "monthly_explanation":
      return {
        summary: projectSummary(input.summary),
        previousSummary: projectSummary(input.previousSummary),
      };
  }
}

/** プロンプトと出力スキーマを組み立てる */
export function buildPrompt(request: AIRequest): BuiltPrompt {
  const sanitized = sanitizeInput(request.kind, request.input);
  return {
    instructions: COMMON_INSTRUCTIONS,
    input: `${TASKS[request.kind]}\n\n入力データ:\n${JSON.stringify(sanitized)}`,
    schemaName: `${request.kind}_result`,
    schema: OUTPUT_SCHEMAS[request.kind],
  };
}

const COMMON_INSTRUCTIONS = `あなたは個人事業主向け経理アプリのAIアシスタントです。
入力データをもとに、指定されたJSONスキーマに厳密に従うJSONだけを出力してください。

共通ルール:
- 金額は日本円の整数(税込)として扱う
- 日付はYYYY-MM-DD形式
- confidenceは0以上1以下の数値
- reasonは日本語で簡潔に根拠を説明する
- 入力データに含まれない情報を推測で補完しない
- 判断できない項目はnull(配列の場合は空配列)にする`;

const TASKS: Record<SuggestionKind, string> = {
  receipt_extraction:
    "以下は証憑(レシート/領収書)のOCRテキストです。合計金額(amount)・取引日付(date)・取引先名(vendor)を抽出してください。",
  account_suggestion:
    "以下の取引情報から最も適切な勘定科目を、accountコード・confidence・reason付きの候補(candidates)として最大3件提示してください。accountCandidatesが与えられた場合はその中から選んでください。",
  duplicate_detection:
    "以下の対象取引(transaction)と既存取引一覧(existingTransactions)を照合し、重複の可能性がある取引をtransactionId・score・reason付きの候補(candidates)として提示してください。",
  transaction_description:
    "以下の取引情報を、確定申告の摘要として使える簡潔な日本語の説明文(description)にしてください。",
  monthly_explanation:
    "以下の今月の集計値(summary)と前月の集計値(previousSummary)を比較し、月次の収支状況を説明(explanation)し、注目すべき変動をhighlightsに列挙してください。",
};

// Structured Outputs(strict)で許容されるJSON Schemaのサブセットのみ使用
// (type/properties/required/additionalProperties/items/anyOf)。
// 形の最終検証は呼び出し側のschemas.tsが行うため、ここではminItems等は使わない。
const confidenceProp = {
  type: "number",
  description: "提案の信頼度(0..1)",
};

const reasonProp = {
  type: "string",
  description: "提案の根拠(日本語・簡潔)",
};

const nullable = (type: string, description: string) => ({
  anyOf: [{ type }, { type: "null" }],
  description,
});

const OUTPUT_SCHEMAS: Record<SuggestionKind, Record<string, unknown>> = {
  receipt_extraction: {
    type: "object",
    additionalProperties: false,
    properties: {
      amount: nullable("integer", "合計金額(円・整数)。不明ならnull"),
      date: nullable("string", "取引日(YYYY-MM-DD)。不明ならnull"),
      vendor: nullable("string", "取引先名。不明ならnull"),
      confidence: confidenceProp,
      reason: reasonProp,
    },
    required: ["amount", "date", "vendor", "confidence", "reason"],
  },
  account_suggestion: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            account: { type: "string", description: "勘定科目コード" },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["account", "confidence", "reason"],
        },
      },
      confidence: confidenceProp,
      reason: reasonProp,
    },
    required: ["candidates", "confidence", "reason"],
  },
  duplicate_detection: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            transactionId: { type: "string" },
            score: { type: "number", description: "重複らしさ(0..1)" },
            reason: { type: "string" },
          },
          required: ["transactionId", "score", "reason"],
        },
      },
      confidence: confidenceProp,
      reason: reasonProp,
    },
    required: ["candidates", "confidence", "reason"],
  },
  transaction_description: {
    type: "object",
    additionalProperties: false,
    properties: {
      description: { type: "string", description: "摘要に使える説明文" },
      confidence: confidenceProp,
      reason: reasonProp,
    },
    required: ["description", "confidence", "reason"],
  },
  monthly_explanation: {
    type: "object",
    additionalProperties: false,
    properties: {
      explanation: { type: "string", description: "月次収支の説明文" },
      highlights: {
        type: "array",
        items: { type: "string" },
        description: "注目すべき変動の一覧",
      },
      confidence: confidenceProp,
      reason: reasonProp,
    },
    required: ["explanation", "highlights", "confidence", "reason"],
  },
};

function asText(value: unknown, max = MAX_TEXT_CHARS): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function pickText(
  input: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const v = asText(input[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** 重複検出に必要な識別・照合項目(id/amount/date)のみへ射影する */
function projectTransaction(value: unknown): Record<string, unknown> {
  const t = asRecord(value);
  const out: Record<string, unknown> = {};
  if (!t) return out;
  const id = asText(t.id, 100);
  const amount = asNumber(t.amount);
  const date = asText(t.date, 10);
  if (id !== undefined) out.id = id;
  if (amount !== undefined) out.amount = amount;
  if (date !== undefined) out.date = date;
  return out;
}

/** 月次集計は集計数値とyearMonthのみ送信し、明細・文字列メモ等は送らない */
function projectSummary(value: unknown): Record<string, unknown> {
  const s = asRecord(value);
  const out: Record<string, unknown> = {};
  if (!s) return out;
  const yearMonth = asText(s.yearMonth, 7);
  if (yearMonth !== undefined) out.yearMonth = yearMonth;
  for (const [key, v] of Object.entries(s)) {
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}
