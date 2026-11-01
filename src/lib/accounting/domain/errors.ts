export type DomainErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_DATE"
  | "VALIDATION_FAILED"
  | "INVALID_STATE"
  | "PERIOD_CLOSED"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "PAYMENT_EXCEEDS_BALANCE";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
