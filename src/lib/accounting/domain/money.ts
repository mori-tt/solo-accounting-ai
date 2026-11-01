import { DomainError } from "./errors";

export function isIntegerYen(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertPositiveYen(
  value: unknown,
  field: string,
): asserts value is number {
  if (!isIntegerYen(value)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} must be an integer yen amount`,
    );
  }
  if (value <= 0) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} must be a positive yen amount`,
    );
  }
}

export function assertNonNegativeYen(
  value: unknown,
  field: string,
): asserts value is number {
  if (!isIntegerYen(value)) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} must be an integer yen amount`,
    );
  }
  if (value < 0) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} must not be a negative yen amount`,
    );
  }
}

export function addYen(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) {
    throw new DomainError("INVALID_AMOUNT", "yen amount overflow");
  }
  return result;
}
