import { z } from "zod";
import { AIResponseValidationError } from "./errors";
import type {
  AccountSuggestionPayload,
  DuplicateDetectionPayload,
  MonthlyExplanationPayload,
  ReceiptExtractionPayload,
  SuggestionKind,
  SuggestionPayload,
  TransactionDescriptionPayload,
} from "./types";

const confidenceSchema = z
  .number()
  .min(0)
  .max(1)
  .optional()
  .transform((v) => (v === undefined ? undefined : Math.min(1, Math.max(0, v))));

const receiptExtractionSchema = z.object({
  amount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? null),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v ?? null),
  vendor: z
    .string()
    .min(1)
    .nullish()
    .transform((v) => v ?? null),
  confidence: confidenceSchema,
  reason: z.string().optional(),
});

const accountSuggestionSchema = z.object({
  candidates: z
    .array(
      z.object({
        account: z.string().min(1),
        confidence: z.number().min(0).max(1),
        reason: z.string().default(""),
      }),
    )
    .min(1),
  confidence: confidenceSchema,
  reason: z.string().optional(),
});

const duplicateDetectionSchema = z.object({
  candidates: z
    .array(
      z.object({
        transactionId: z.string().min(1),
        score: z.number().min(0).max(1),
        reason: z.string().default(""),
      }),
    ),
  confidence: confidenceSchema,
  reason: z.string().optional(),
});

const transactionDescriptionSchema = z.object({
  description: z.string().min(1),
  confidence: confidenceSchema,
  reason: z.string().optional(),
});

const monthlyExplanationSchema = z.object({
  explanation: z.string().min(1),
  highlights: z.array(z.string()).default([]),
  confidence: confidenceSchema,
  reason: z.string().optional(),
});

export interface NormalizedSuggestion {
  payload: SuggestionPayload;
  /** AI自身が返した信頼度。未指定の場合はundefined(呼び出し側で既定値を決める) */
  confidence: number | undefined;
  /** AI自身が返した根拠。未指定の場合はundefined */
  reason: string | undefined;
  /** 判断不能にする問題のコード列。空ならpendingでよい */
  issues: string[];
}

const KIND_DEFAULT_CONFIDENCE: Record<SuggestionKind, number> = {
  receipt_extraction: 0.5,
  account_suggestion: 0.5,
  duplicate_detection: 0.5,
  transaction_description: 0.5,
  monthly_explanation: 0.5,
};

function parseWith<T extends z.ZodType>(
  schema: T,
  raw: unknown,
): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AIResponseValidationError(
      `AI response does not match expected shape: ${result.error.issues
        .map((i) => i.path.join(".") || "(root)")
        .join(", ")}`,
    );
  }
  return result.data;
}

/** 生のAIレスポンスを検証・正規化する。形が不正ならAIResponseValidationError */
export function normalizeAIResponse(
  kind: SuggestionKind,
  raw: unknown,
): NormalizedSuggestion {
  switch (kind) {
    case "receipt_extraction": {
      const data = parseWith(receiptExtractionSchema, raw);
      const payload: ReceiptExtractionPayload = {
        amount: data.amount,
        date: data.date,
        vendor: data.vendor,
      };
      const issues: string[] = [];
      if (payload.amount === null) issues.push("amount_unreadable");
      if (payload.date === null) issues.push("date_unreadable");
      if (payload.vendor === null) issues.push("vendor_unknown");
      return {
        payload,
        confidence: data.confidence,
        reason: data.reason,
        issues,
      };
    }
    case "account_suggestion": {
      const data = parseWith(accountSuggestionSchema, raw);
      const payload: AccountSuggestionPayload = {
        candidates: data.candidates,
      };
      return {
        payload,
        confidence: data.confidence,
        reason: data.reason,
        issues: [],
      };
    }
    case "duplicate_detection": {
      const data = parseWith(duplicateDetectionSchema, raw);
      const payload: DuplicateDetectionPayload = {
        candidates: data.candidates,
      };
      return {
        payload,
        confidence: data.confidence,
        reason: data.reason,
        issues: [],
      };
    }
    case "transaction_description": {
      const data = parseWith(transactionDescriptionSchema, raw);
      const payload: TransactionDescriptionPayload = {
        description: data.description,
      };
      return {
        payload,
        confidence: data.confidence,
        reason: data.reason,
        issues: [],
      };
    }
    case "monthly_explanation": {
      const data = parseWith(monthlyExplanationSchema, raw);
      const payload: MonthlyExplanationPayload = {
        explanation: data.explanation,
        highlights: data.highlights,
      };
      return {
        payload,
        confidence: data.confidence,
        reason: data.reason,
        issues: [],
      };
    }
  }
}

export function defaultConfidence(kind: SuggestionKind): number {
  return KIND_DEFAULT_CONFIDENCE[kind];
}

/** AIが根拠を返さなかった場合のフォールバック文言 */
export function fallbackReason(kind: SuggestionKind, issues: string[]): string {
  if (issues.length > 0) {
    return `AIが${kindLabel(kind)}を生成しましたが、一部の項目を判定できませんでした(${issues.join(", ")})`;
  }
  return `AIが${kindLabel(kind)}を生成しました`;
}

function kindLabel(kind: SuggestionKind): string {
  switch (kind) {
    case "receipt_extraction":
      return "証憑抽出";
    case "account_suggestion":
      return "勘定科目候補";
    case "duplicate_detection":
      return "重複候補";
    case "transaction_description":
      return "取引内容の説明";
    case "monthly_explanation":
      return "月次変動の説明";
  }
}
