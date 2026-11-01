import { assertFiscalStartMonth } from "../dates";
import { DomainError } from "../errors";
import type { AccountingStore } from "../store/types";
import type { Business, TaxMode } from "../types";
import { auditsFor, newId, nowOf, type ActorContext } from "./common";

const TAX_MODES: readonly TaxMode[] = ["exempt", "simple", "standard"];

export interface RegisterBusinessInput {
  /** 省略時は自動採番 */
  id?: string;
  name: string;
  ownerUid: string;
  /** 会計年度開始月(1-12)。個人事業主のデフォルトは1 */
  fiscalYearStartMonth?: number;
  taxMode?: TaxMode;
  idempotencyKey?: string;
}

export async function registerBusiness(
  store: AccountingStore,
  actor: ActorContext,
  input: RegisterBusinessInput,
): Promise<{ business: Business; replayed: boolean }> {
  const fiscalYearStartMonth = assertFiscalStartMonth(
    input.fiscalYearStartMonth ?? 1,
  );
  const taxMode = input.taxMode ?? "exempt";
  if (!TAX_MODES.includes(taxMode)) {
    throw new DomainError("INVALID_TAX_MODE", `invalid taxMode: ${taxMode}`);
  }
  if (!input.name || !input.ownerUid) {
    throw new DomainError("INVALID_INPUT", "name and ownerUid are required");
  }

  const id = input.id ?? newId();
  const at = nowOf(actor);
  const business: Business = {
    id,
    name: input.name,
    ownerUid: input.ownerUid,
    fiscalYearStartMonth,
    taxMode,
    createdAt: at,
    updatedAt: at,
  };

  const { replayed, value } = await store.transact(
    id,
    { idempotencyKey: input.idempotencyKey },
    async (tx) => {
      const existing = await tx.getBusiness(id);
      if (existing) {
        return { batch: { puts: [], audits: [] }, value: existing };
      }
      return {
        batch: {
          puts: [{ collection: "businesses", id, data: business }],
          audits: auditsFor(
            id,
            [{ collection: "businesses", id }],
            "create",
            actor,
          ),
        },
        value: business,
      };
    },
  );
  return { business: value, replayed };
}
