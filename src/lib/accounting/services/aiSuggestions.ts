import { DomainError } from "../errors";
import type { AccountingStore } from "../store/types";
import {
  applySuggestionToTransaction,
  buildSuggestion,
  suggestionFieldsPresent,
  type TransactionSuggestionField,
} from "../suggestions";
import type { AiSuggestion, Receipt, Transaction } from "../types";
import {
  assertDateInOpenPeriod,
  assertTransactionEditable,
  auditsFor,
  nowOf,
  type ActorContext,
} from "./common";

export interface RecordSuggestionInput {
  suggested: Record<string, unknown>;
  /** 0.0〜1.0。必須 */
  confidence: number;
  rationale?: string;
  model?: string;
}

/**
 * AI提案を aiSuggestion フィールドに記録する。
 * 確定フィールドには一切触れない(docs/AI_POLICY.md)。
 * この関数はサーバーサイド(Admin SDK経由)からのみ呼ぶこと。
 */
export async function recordTransactionSuggestion(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  transactionId: string,
  input: RecordSuggestionInput,
): Promise<{ suggestion: AiSuggestion }> {
  const suggestion = buildSuggestion({ ...input, at: nowOf(actor) });
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const transaction = await tx.getTransaction(businessId, transactionId);
    if (!transaction) {
      throw new DomainError(
        "NOT_FOUND",
        `transaction ${transactionId} not found`,
      );
    }
    await assertTransactionEditable(tx, businessId, transaction);
    const next: Transaction = {
      ...transaction,
      aiSuggestion: suggestion,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [{ collection: "transactions", id: transactionId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "transactions", id: transactionId }],
          "ai_suggest",
          actor,
        ),
      },
      value: suggestion,
    };
  });
  return { suggestion: value };
}

/**
 * 提案の採用: ユーザーが提案値を確定フィールドへコピーする操作。
 * - fields 省略時は提案に含まれる許可フィールドすべてを適用する
 * - 適用後も status は draft のまま(confirmed は confirmTransaction のみ)
 * - 提案が pending でない場合は拒否する
 */
export async function approveTransactionSuggestion(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  transactionId: string,
  fields?: readonly TransactionSuggestionField[],
): Promise<{ transaction: Transaction }> {
  const at = nowOf(actor);
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const transaction = await tx.getTransaction(businessId, transactionId);
    if (!transaction) {
      throw new DomainError(
        "NOT_FOUND",
        `transaction ${transactionId} not found`,
      );
    }
    const suggestion = transaction.aiSuggestion;
    if (!suggestion) {
      throw new DomainError(
        "SUGGESTION_NOT_FOUND",
        `transaction ${transactionId} has no AI suggestion`,
      );
    }
    if (suggestion.status === "approved") {
      return { batch: { puts: [], audits: [] }, value: transaction };
    }
    if (suggestion.status !== "pending") {
      throw new DomainError(
        "SUGGESTION_NOT_PENDING",
        `suggestion is ${suggestion.status}`,
      );
    }
    await assertTransactionEditable(tx, businessId, transaction);

    const applyFields = fields ?? suggestionFieldsPresent(suggestion);
    const applied = applySuggestionToTransaction(
      transaction,
      suggestion,
      applyFields,
    );
    // 提案で日付が変わる場合、その日付が締め済み期間に入っていないか確認する
    if (applied.date !== transaction.date) {
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(applied.date, periods);
    }

    const next: Transaction = {
      ...applied,
      aiSuggestion: {
        ...suggestion,
        status: "approved",
        decidedAt: at,
        decidedBy: actor.uid,
      },
      updatedAt: at,
    };
    return {
      batch: {
        puts: [{ collection: "transactions", id: transactionId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "transactions", id: transactionId }],
          "approve_ai",
          actor,
        ),
      },
      value: next,
    };
  });
  return { transaction: value };
}

/**
 * 提案の拒否。確定フィールドは一切変更しない。
 */
export async function rejectTransactionSuggestion(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  transactionId: string,
): Promise<{ transaction: Transaction }> {
  const at = nowOf(actor);
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const transaction = await tx.getTransaction(businessId, transactionId);
    if (!transaction) {
      throw new DomainError(
        "NOT_FOUND",
        `transaction ${transactionId} not found`,
      );
    }
    const suggestion = transaction.aiSuggestion;
    if (!suggestion) {
      throw new DomainError(
        "SUGGESTION_NOT_FOUND",
        `transaction ${transactionId} has no AI suggestion`,
      );
    }
    if (suggestion.status === "rejected") {
      return { batch: { puts: [], audits: [] }, value: transaction };
    }
    if (suggestion.status !== "pending") {
      throw new DomainError(
        "SUGGESTION_NOT_PENDING",
        `suggestion is ${suggestion.status}`,
      );
    }
    const next: Transaction = {
      ...transaction,
      aiSuggestion: {
        ...suggestion,
        status: "rejected",
        decidedAt: at,
        decidedBy: actor.uid,
      },
      updatedAt: at,
    };
    return {
      batch: {
        puts: [{ collection: "transactions", id: transactionId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "transactions", id: transactionId }],
          "reject_ai",
          actor,
        ),
      },
      value: next,
    };
  });
  return { transaction: value };
}

/** 証憑の抽出結果を aiSuggestion として記録する(サーバーサイド専用)。 */
export async function recordReceiptSuggestion(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  receiptId: string,
  input: RecordSuggestionInput,
): Promise<{ suggestion: AiSuggestion }> {
  const suggestion = buildSuggestion({ ...input, at: nowOf(actor) });
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const receipt = await tx.getReceipt(businessId, receiptId);
    if (!receipt) {
      throw new DomainError("NOT_FOUND", `receipt ${receiptId} not found`);
    }
    const next: Receipt = {
      ...receipt,
      aiSuggestion: suggestion,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [{ collection: "receipts", id: receiptId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "receipts", id: receiptId }],
          "ai_suggest",
          actor,
        ),
      },
      value: suggestion,
    };
  });
  return { suggestion: value };
}

/** 証憑提案の採否。提案の採用は status を approved にするだけで、取引の自動作成はしない。 */
export async function decideReceiptSuggestion(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  receiptId: string,
  decision: "approved" | "rejected",
): Promise<{ receipt: Receipt }> {
  const at = nowOf(actor);
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const receipt = await tx.getReceipt(businessId, receiptId);
    if (!receipt) {
      throw new DomainError("NOT_FOUND", `receipt ${receiptId} not found`);
    }
    const suggestion = receipt.aiSuggestion;
    if (!suggestion) {
      throw new DomainError(
        "SUGGESTION_NOT_FOUND",
        `receipt ${receiptId} has no AI suggestion`,
      );
    }
    if (suggestion.status === decision) {
      return { batch: { puts: [], audits: [] }, value: receipt };
    }
    if (suggestion.status !== "pending") {
      throw new DomainError(
        "SUGGESTION_NOT_PENDING",
        `suggestion is ${suggestion.status}`,
      );
    }
    const next: Receipt = {
      ...receipt,
      aiSuggestion: {
        ...suggestion,
        status: decision,
        decidedAt: at,
        decidedBy: actor.uid,
      },
      updatedAt: at,
    };
    return {
      batch: {
        puts: [{ collection: "receipts", id: receiptId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "receipts", id: receiptId }],
          decision === "approved" ? "approve_ai" : "reject_ai",
          actor,
        ),
      },
      value: next,
    };
  });
  return { receipt: value };
}
