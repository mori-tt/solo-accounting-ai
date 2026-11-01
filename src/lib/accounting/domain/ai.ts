import { assertISODate, type ISODate } from "./dates";
import { DomainError } from "./errors";
import { assertPositiveYen } from "./money";
import type { AiSuggestion, TransactionEntity } from "./types";
import { assertConfidence } from "./validate";

export const AI_REVIEW_CONFIDENCE_THRESHOLD = 0.8;

export interface AiSuggestionFields {
  confidence: number;
  account?: string | null;
  amount?: number | null;
  date?: ISODate | null;
  counterparty?: string | null;
  rationale?: string | null;
}

export function buildAiSuggestion(
  fields: AiSuggestionFields,
  suggestedAt: Date,
): AiSuggestion {
  assertConfidence(fields.confidence);
  if (fields.amount !== undefined && fields.amount !== null) {
    assertPositiveYen(fields.amount, "aiSuggestion.amount");
  }
  if (fields.date !== undefined && fields.date !== null) {
    assertISODate(fields.date, "aiSuggestion.date");
  }
  return {
    status: "pending",
    confidence: fields.confidence,
    account: fields.account ?? null,
    amount: fields.amount ?? null,
    date: fields.date ?? null,
    counterparty: fields.counterparty ?? null,
    rationale: fields.rationale ?? null,
    suggestedAt,
  };
}

export function suggestionNeedsReview(suggestion: AiSuggestion): boolean {
  return suggestion.confidence < AI_REVIEW_CONFIDENCE_THRESHOLD;
}

export function assertPendingSuggestion(
  suggestion: AiSuggestion | null,
): asserts suggestion is AiSuggestion {
  if (!suggestion) {
    throw new DomainError("INVALID_STATE", "no AI suggestion exists");
  }
  if (suggestion.status !== "pending") {
    throw new DomainError(
      "INVALID_STATE",
      `AI suggestion has already been ${suggestion.status}`,
    );
  }
}

export function suggestedFieldPatch(
  suggestion: AiSuggestion,
): Partial<Pick<TransactionEntity, "account" | "amount" | "date" | "counterparty">> {
  const patch: Partial<
    Pick<TransactionEntity, "account" | "amount" | "date" | "counterparty">
  > = {};
  if (suggestion.account !== null) patch.account = suggestion.account;
  if (suggestion.amount !== null) patch.amount = suggestion.amount;
  if (suggestion.date !== null) patch.date = suggestion.date;
  if (suggestion.counterparty !== null) patch.counterparty = suggestion.counterparty;
  return patch;
}
