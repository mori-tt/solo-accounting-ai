import { assertDateString } from "./dates";
import { DomainError } from "./errors";
import { assertYenAmount } from "./money";
import type { AiSuggestion, Transaction } from "./types";

/**
 * 信頼度がこの値未満の提案は「要確認」として扱う(docs/AI_POLICY.md)。
 * ただし閾値以上でも自動確定はしない。
 */
export const AI_CONFIDENCE_THRESHOLD = 0.7;

export function buildSuggestion(input: {
  suggested: Record<string, unknown>;
  confidence: number;
  rationale?: string;
  model?: string;
  at: string;
}): AiSuggestion {
  if (
    typeof input.confidence !== "number" ||
    Number.isNaN(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    throw new DomainError(
      "INVALID_SUGGESTION",
      "confidence must be a number between 0 and 1",
      { confidence: input.confidence },
    );
  }
  if (!input.suggested || Object.keys(input.suggested).length === 0) {
    throw new DomainError(
      "INVALID_SUGGESTION",
      "suggestion must contain at least one field",
    );
  }
  return {
    suggested: input.suggested,
    confidence: input.confidence,
    rationale: input.rationale,
    model: input.model,
    needsReview: input.confidence < AI_CONFIDENCE_THRESHOLD,
    status: "pending",
    suggestedAt: input.at,
  };
}

/**
 * AI提案から確定値へコピーしてよいTransactionフィールド。
 * これ以外のキー(status, createdBy, receiptIds 等)は提案経由で上書きしない。
 */
export const TRANSACTION_SUGGESTION_FIELDS = [
  "account",
  "amount",
  "date",
  "counterparty",
  "description",
  "type",
] as const;

export type TransactionSuggestionField =
  (typeof TRANSACTION_SUGGESTION_FIELDS)[number];

/**
 * 提案値をTransactionの確定フィールドへ適用した新しい値を返す。
 * status は変更しない。採用しても draft のままであり、
 * confirmed への遷移は別途ユーザーの確定操作が必要(ACCOUNTING_RULES.md)。
 */
export function applySuggestionToTransaction(
  transaction: Transaction,
  suggestion: AiSuggestion,
  fields: readonly TransactionSuggestionField[],
): Transaction {
  const next: Transaction = { ...transaction };
  for (const field of fields) {
    if (!TRANSACTION_SUGGESTION_FIELDS.includes(field)) {
      throw new DomainError(
        "SUGGESTION_FIELD_FORBIDDEN",
        `field ${field} cannot be set from an AI suggestion`,
      );
    }
    const value = suggestion.suggested[field];
    if (value === undefined) {
      throw new DomainError(
        "INVALID_SUGGESTION",
        `suggestion does not contain field ${field}`,
      );
    }
    switch (field) {
      case "amount":
        next.amount = assertYenAmount(value, "amount");
        break;
      case "date":
        next.date = assertDateString(value, "date");
        break;
      case "type":
        if (value !== "income" && value !== "expense" && value !== "transfer") {
          throw new DomainError(
            "INVALID_SUGGESTION",
            `invalid transaction type: ${String(value)}`,
          );
        }
        next.type = value;
        break;
      case "account":
        if (typeof value !== "string" || value.length === 0) {
          throw new DomainError(
            "INVALID_SUGGESTION",
            "suggested account must be a non-empty string",
          );
        }
        next.account = value;
        break;
      case "counterparty":
      case "description":
        if (typeof value !== "string") {
          throw new DomainError(
            "INVALID_SUGGESTION",
            `suggested ${field} must be a string`,
          );
        }
        next[field] = value;
        break;
    }
  }
  return next;
}

export function suggestionFieldsPresent(
  suggestion: AiSuggestion,
): TransactionSuggestionField[] {
  return TRANSACTION_SUGGESTION_FIELDS.filter(
    (f) => suggestion.suggested[f] !== undefined,
  );
}
