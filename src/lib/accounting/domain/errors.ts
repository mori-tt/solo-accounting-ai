import { DomainError } from "../errors";

/**
 * DomainError はルート側(../errors.ts)の実装に統一。
 * DomainErrorCode もルート側の union をそのまま使う
 * (domain 固有の VALIDATION_FAILED/INVALID_STATE/ALREADY_EXISTS/
 * PAYMENT_EXCEEDS_BALANCE はルート側 union に取り込み済み)。
 */
export { DomainError };
export type { DomainErrorCode } from "../errors";

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
