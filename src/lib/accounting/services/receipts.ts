import { DomainError } from "../errors";
import type { AccountingStore, PutOp } from "../store/types";
import type { Receipt } from "../types";
import {
  assertTransactionEditable,
  auditsFor,
  newId,
  nowOf,
  type ActorContext,
} from "./common";

export interface RegisterReceiptInput {
  id?: string;
  /** Cloud Storage上のパス receipts/{businessId}/... */
  storagePath: string;
  fileName: string;
  mimeType: string;
  idempotencyKey?: string;
}

/** 証憑メタデータを unprocessed で登録する。 */
export async function registerReceipt(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterReceiptInput,
): Promise<{ receipt: Receipt; replayed: boolean }> {
  if (!input.storagePath || !input.fileName || !input.mimeType) {
    throw new DomainError(
      "INVALID_INPUT",
      "storagePath, fileName and mimeType are required",
    );
  }
  const id = input.id ?? newId();
  const at = nowOf(actor);
  const receipt: Receipt = {
    id,
    storagePath: input.storagePath,
    fileName: input.fileName,
    mimeType: input.mimeType,
    status: "unprocessed",
    createdBy: actor.uid,
    createdAt: at,
    updatedAt: at,
  };
  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: input.idempotencyKey },
    async () => ({
      batch: {
        puts: [{ collection: "receipts", id, data: receipt }],
        audits: auditsFor(
          businessId,
          [{ collection: "receipts", id }],
          "create",
          actor,
        ),
      },
      value: receipt,
    }),
  );
  return { receipt: value, replayed };
}

/**
 * 証憑を取引に紐付ける。
 * 紐付け先が締め済み(locked)の場合は拒否する。
 * 同じ取引への再実行は冪等に成功する。
 */
export async function linkReceiptToTransaction(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  receiptId: string,
  transactionId: string,
): Promise<{ receipt: Receipt }> {
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const receipt = await tx.getReceipt(businessId, receiptId);
    if (!receipt) {
      throw new DomainError("NOT_FOUND", `receipt ${receiptId} not found`);
    }
    if (receipt.status === "archived") {
      throw new DomainError(
        "INVALID_STATUS_TRANSITION",
        `receipt ${receiptId} is archived`,
      );
    }
    if (receipt.transactionId === transactionId && receipt.status === "linked") {
      return { batch: { puts: [], audits: [] }, value: receipt };
    }
    const transaction = await tx.getTransaction(businessId, transactionId);
    if (!transaction) {
      throw new DomainError(
        "NOT_FOUND",
        `transaction ${transactionId} not found`,
      );
    }
    await assertTransactionEditable(tx, businessId, transaction);

    const at = nowOf(actor);
    const receiptNext: Receipt = {
      ...receipt,
      status: "linked",
      transactionId,
      updatedAt: at,
    };
    const receiptIds = transaction.receiptIds.includes(receiptId)
      ? transaction.receiptIds
      : [...transaction.receiptIds, receiptId];
    const transactionNext = { ...transaction, receiptIds, updatedAt: at };
    return {
      batch: {
        puts: [
          { collection: "receipts", id: receiptId, data: receiptNext },
          { collection: "transactions", id: transactionId, data: transactionNext },
        ],
        audits: auditsFor(
          businessId,
          [
            { collection: "receipts", id: receiptId },
            { collection: "transactions", id: transactionId },
          ],
          "update",
          actor,
        ),
      },
      value: receiptNext,
    };
  });
  return { receipt: value };
}

/**
 * 証憑をアーカイブする。紐付いていた取引からは外す。
 * 紐付け先の取引が締め済みの場合は拒否する。
 */
export async function archiveReceipt(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  receiptId: string,
): Promise<{ receipt: Receipt }> {
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const receipt = await tx.getReceipt(businessId, receiptId);
    if (!receipt) {
      throw new DomainError("NOT_FOUND", `receipt ${receiptId} not found`);
    }
    if (receipt.status === "archived") {
      return { batch: { puts: [], audits: [] }, value: receipt };
    }

    const at = nowOf(actor);
    const receiptNext: Receipt = {
      ...receipt,
      status: "archived",
      transactionId: undefined,
      updatedAt: at,
    };
    const puts: PutOp[] = [
      { collection: "receipts", id: receiptId, data: receiptNext },
    ];
    const auditTargets: { collection: "receipts" | "transactions"; id: string }[] =
      [{ collection: "receipts", id: receiptId }];

    if (receipt.transactionId !== undefined) {
      const transaction = await tx.getTransaction(
        businessId,
        receipt.transactionId,
      );
      if (transaction) {
        await assertTransactionEditable(tx, businessId, transaction);
        puts.push({
          collection: "transactions",
          id: transaction.id,
          data: {
            ...transaction,
            receiptIds: transaction.receiptIds.filter((r) => r !== receiptId),
            updatedAt: at,
          },
        });
        auditTargets.push({
          collection: "transactions",
          id: transaction.id,
        });
      }
    }
    return {
      batch: { puts, audits: auditsFor(businessId, auditTargets, "update", actor) },
      value: receiptNext,
    };
  });
  return { receipt: value };
}
