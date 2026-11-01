export type DomainErrorCode =
  | "INVALID_INPUT"
  | "INVALID_AMOUNT"
  | "INVALID_DATE"
  | "INVALID_TAX_MODE"
  | "INVALID_FISCAL_MONTH"
  | "INVALID_QUANTITY"
  | "AMOUNT_MISMATCH"
  | "DUE_BEFORE_ISSUE"
  | "NOT_FOUND"
  | "PERIOD_CLOSED"
  | "PERIOD_OVERLAP"
  | "PERIOD_NOT_OPEN"
  | "HAS_DRAFT_TRANSACTIONS"
  | "INVALID_STATUS_TRANSITION"
  | "ALREADY_PAID"
  | "OVERPAID"
  | "SUGGESTION_NOT_FOUND"
  | "SUGGESTION_NOT_PENDING"
  | "SUGGESTION_FIELD_FORBIDDEN"
  | "INVALID_SUGGESTION";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: DomainErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}
