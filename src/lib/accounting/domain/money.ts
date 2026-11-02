import {
  assertNonNegativeYen as assertNonNegativeYenAmount,
  assertYenAmount,
} from "../money";
import { DomainError } from "./errors";

export function isIntegerYen(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertPositiveYen(
  value: unknown,
  field: string,
): asserts value is number {
  assertYenAmount(value, field);
}

export function assertNonNegativeYen(
  value: unknown,
  field: string,
): asserts value is number {
  assertNonNegativeYenAmount(value, field);
}

export function addYen(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) {
    throw new DomainError("INVALID_AMOUNT", "yen amount overflow");
  }
  return result;
}
