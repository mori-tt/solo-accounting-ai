import { assertDateString } from "../dates";
import { DomainError } from "../errors";
import { assertYenAmount } from "../money";
import type { AccountingStore } from "../store/types";
import { docPath } from "../store/types";
import type { ConsumptionTaxRate } from "../domain/tax";
import type {
  TaxCategory,
  Transaction,
  TransactionType,
} from "../types";
import {
  assertDateInOpenPeriod,
  auditsFor,
  newId,
  nowOf,
  type ActorContext,
} from "./common";

const TRANSACTION_TYPES: readonly TransactionType[] = [
  "income",
  "expense",
  "transfer",
];

const TAX_CATEGORIES: readonly TaxCategory[] = [
  "taxable",
  "non_taxable",
  "exempt",
  "out_of_scope",
];

const TAX_RATES: readonly ConsumptionTaxRate[] = ["standard", "reduced"];

/**
 * 取引の消費税区分を検証し、保存用に正規化する。
 * 課税取引で税率未指定なら standard(10%)とみなす。
 * 課税以外の区分に税率は付けられない。
 */
export function normalizeTransactionTax(
  taxCategory: TaxCategory | undefined,
  taxRate: ConsumptionTaxRate | undefined,
): { taxCategory?: TaxCategory; taxRate?: ConsumptionTaxRate } {
  if (taxCategory !== undefined && !TAX_CATEGORIES.includes(taxCategory)) {
    throw new DomainError(
      "INVALID_INPUT",
      `invalid taxCategory: ${String(taxCategory)}`,
    );
  }
  if (taxRate !== undefined && !TAX_RATES.includes(taxRate)) {
    throw new DomainError(
      "INVALID_INPUT",
      `invalid taxRate: ${String(taxRate)}`,
    );
  }
  if (taxCategory === undefined) {
    if (taxRate !== undefined) {
      throw new DomainError(
        "INVALID_INPUT",
        "taxRate requires taxCategory=taxable",
      );
    }
    return {};
  }
  if (taxCategory !== "taxable") {
    if (taxRate !== undefined) {
      throw new DomainError(
        "INVALID_INPUT",
        "taxRate requires taxCategory=taxable",
      );
    }
    return { taxCategory };
  }
  return { taxCategory, taxRate: taxRate ?? "standard" };
}

export interface RegisterTransactionInput {
  id?: string;
  /** リトライ安全のため必須。同じキーでの再実行は既存結果を返す */
  idempotencyKey: string;
  type: TransactionType;
  /** YYYY-MM-DD */
  date: string;
  /** 円・整数・正数 */
  amount: number;
  /** 勘定科目コード */
  account: string;
  counterparty?: string;
  description?: string;
  /** 消費税区分(任意)。省略時は未分類 */
  taxCategory?: TaxCategory;
  /** 税率区分。taxCategory=taxable のときのみ有効(省略時 standard) */
  taxRate?: ConsumptionTaxRate;
}

/**
 * 取引を draft として登録する。
 * 登録直後は確定ではなく、confirmTransaction でユーザーが確定する。
 */
export async function registerTransaction(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterTransactionInput,
): Promise<{ transaction: Transaction; replayed: boolean }> {
  const date = assertDateString(input.date);
  const amount = assertYenAmount(input.amount);
  if (!TRANSACTION_TYPES.includes(input.type)) {
    throw new DomainError(
      "INVALID_INPUT",
      `invalid transaction type: ${String(input.type)}`,
    );
  }
  if (!input.account) {
    throw new DomainError("INVALID_INPUT", "account is required");
  }
  const tax = normalizeTransactionTax(input.taxCategory, input.taxRate);

  const id = input.id ?? newId();
  const at = nowOf(actor);

  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: input.idempotencyKey },
    async (tx) => {
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(date, periods);

      const existing = await tx.getTransaction(businessId, id);
      if (existing) {
        throw new DomainError(
          "INVALID_INPUT",
          `transaction ${id} already exists`,
          { transactionId: id },
        );
      }

      const transaction: Transaction = {
        id,
        type: input.type,
        date,
        amount,
        account: input.account,
        counterparty: input.counterparty ?? "",
        description: input.description ?? "",
        receiptIds: [],
        status: "draft",
        taxCategory: tax.taxCategory,
        taxRate: tax.taxRate,
        createdBy: actor.uid,
        createdAt: at,
        updatedAt: at,
      };
      return {
        batch: {
          puts: [{ collection: "transactions", id, data: transaction }],
          audits: auditsFor(
            businessId,
            [{ collection: "transactions", id }],
            "create",
            actor,
          ),
        },
        value: transaction,
      };
    },
  );
  return { transaction: value, replayed };
}

/**
 * draft → confirmed。confirmed/locked は既に確定なので、
 * confirmed に対する再実行は冪等に成功として扱う。
 */
export async function confirmTransaction(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  transactionId: string,
): Promise<{ transaction: Transaction }> {
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getTransaction(businessId, transactionId);
    if (!current) {
      throw new DomainError(
        "NOT_FOUND",
        `transaction ${transactionId} not found`,
      );
    }
    if (current.status === "confirmed") {
      return { batch: { puts: [], audits: [] }, value: current };
    }
    if (current.status === "locked") {
      throw new DomainError(
        "PERIOD_CLOSED",
        `transaction ${transactionId} is locked`,
      );
    }
    const periods = await tx.listFiscalPeriods(businessId);
    assertDateInOpenPeriod(current.date, periods);

    const next: Transaction = {
      ...current,
      status: "confirmed",
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [{ collection: "transactions", id: transactionId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "transactions", id: transactionId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { transaction: value };
}

export function transactionPath(
  businessId: string,
  transactionId: string,
): string {
  return docPath(businessId, "transactions", transactionId);
}
