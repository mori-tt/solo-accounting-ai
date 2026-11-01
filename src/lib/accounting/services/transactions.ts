import { assertDateString } from "../dates";
import { DomainError } from "../errors";
import { assertYenAmount } from "../money";
import type { AccountingStore } from "../store/types";
import { docPath } from "../store/types";
import type { Transaction, TransactionType } from "../types";
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
