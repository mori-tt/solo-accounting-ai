import { DomainError } from "./errors";

/**
 * 金額は円単位の整数のみ許可する(docs/ACCOUNTING_RULES.md)。
 * 取引・請求の登録額は 0 円・負数を受け付けない。
 * 負の金額が必要な訂正は、次のオープン期間への取消し仕訳で表現する。
 */
export function assertYenAmount(value: unknown, field = "amount"): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} must be an integer yen amount`,
      { field, value },
    );
  }
  if (value <= 0) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} must be a positive integer yen amount`,
      { field, value },
    );
  }
  return value;
}

/**
 * 税額・単価など 0 円を許容する金額フィールド。
 */
export function assertNonNegativeYen(value: unknown, field = "amount"): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} must be an integer yen amount`,
      { field, value },
    );
  }
  if (value < 0) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} must not be negative`,
      { field, value },
    );
  }
  return value;
}
