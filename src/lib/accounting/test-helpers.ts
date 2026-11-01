import { InMemoryAccountingStore } from "./memory-store";
import { AccountingService } from "./service";
import type { DomainErrorCode } from "./domain/errors";
import { expect } from "vitest";

export const NOW = new Date("2026-10-31T09:00:00.000Z");
export const BIZ = "biz-1";
export const ACTOR = "user-1";

export function setup(clock: () => Date = () => NOW) {
  const store = new InMemoryAccountingStore();
  let sequence = 0;
  const service = new AccountingService(store, {
    clock,
    newId: () => `id-${String(++sequence).padStart(4, "0")}`,
  });
  return { store, service };
}

export async function expectDomainError(
  promise: Promise<unknown>,
  code: DomainErrorCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}
