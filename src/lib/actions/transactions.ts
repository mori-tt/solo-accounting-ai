"use server";

import {
  confirmTransaction,
  normalizeTransactionTax,
  registerTransaction,
} from "@/lib/accounting/services/transactions";
import {
  assertDateInOpenPeriod,
  auditsFor,
} from "@/lib/accounting/services/common";
import { DomainError } from "@/lib/accounting/errors";
import type { Transaction } from "@/lib/accounting/types";
import {
  deleteTransactionDoc,
  writeAuditLog,
} from "@/lib/api/queries";
import { ApiError, fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  parseForm,
  transactionSchema,
  type TransactionInput,
} from "@/lib/validation/schemas";

/** 期間指定の取引一覧(両端含む YYYY-MM-DD) */
export async function listTransactions(
  businessId: string,
  range: { startDate: string; endDate: string },
): Promise<ActionResult<Transaction[]>> {
  return run(async () => {
    await requireViewer(businessId);
    return getStore().listTransactionsInRange(
      businessId,
      range.startDate,
      range.endDate,
    );
  });
}

/** 取引の登録(draftとして作成) */
export async function createTransaction(
  businessId: string,
  input: TransactionInput & { idempotencyKey: string },
): Promise<ActionResult<Transaction>> {
  const parsed = parseForm(transactionSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { transaction } = await registerTransaction(
      getStore(),
      businessId,
      actor,
      {
        idempotencyKey: input.idempotencyKey,
        type: parsed.data.type,
        date: parsed.data.date,
        amount: parsed.data.amount,
        account: parsed.data.account,
        counterparty: parsed.data.counterparty,
        description: parsed.data.description,
        taxCategory: parsed.data.taxCategory ?? undefined,
        taxRate: parsed.data.taxRate ?? undefined,
      },
    );
    return transaction;
  });
}

/** 取引の編集。locked(締め済み)は変更不可。 */
export async function updateTransaction(
  businessId: string,
  transactionId: string,
  input: TransactionInput,
): Promise<ActionResult<Transaction>> {
  const parsed = parseForm(transactionSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const store = getStore();
    const { value } = await store.transact(businessId, {}, async (tx) => {
      const current = await tx.getTransaction(businessId, transactionId);
      if (!current) {
        throw new DomainError(
          "NOT_FOUND",
          `transaction ${transactionId} not found`,
        );
      }
      if (current.status === "locked") {
        throw new DomainError(
          "PERIOD_CLOSED",
          "締め済み期間の取引は変更できません",
        );
      }
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(parsed.data.date, periods);
      // 税区分: 省略は既存値を保持、nullはクリア(フォームは必ず値かnullを送る)
      const taxCategory =
        parsed.data.taxCategory === undefined
          ? current.taxCategory
          : (parsed.data.taxCategory ?? undefined);
      const taxRate =
        parsed.data.taxRate === undefined
          ? current.taxRate
          : (parsed.data.taxRate ?? undefined);
      const tax = normalizeTransactionTax(
        taxCategory,
        taxCategory === "taxable" ? taxRate : undefined,
      );

      const next: Transaction = {
        ...current,
        type: parsed.data.type,
        date: parsed.data.date,
        amount: parsed.data.amount,
        account: parsed.data.account,
        counterparty: parsed.data.counterparty ?? "",
        description: parsed.data.description ?? "",
        taxCategory: tax.taxCategory,
        taxRate: tax.taxRate,
        updatedAt: new Date().toISOString(),
      };
      return {
        batch: {
          puts: [
            {
              collection: "transactions" as const,
              id: transactionId,
              data: next,
            },
          ],
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
    return value;
  });
}

/** draft → confirmed。AI提案の適用だけでは確定しない、ユーザーの確定操作。 */
export async function confirmTransactionAction(
  businessId: string,
  transactionId: string,
): Promise<ActionResult<Transaction>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { transaction } = await confirmTransaction(
      getStore(),
      businessId,
      actor,
      transactionId,
    );
    return transaction;
  });
}

/** 取引の削除(draftのみ・確認ダイアログ必須) */
export async function deleteTransaction(
  businessId: string,
  transactionId: string,
): Promise<ActionResult<null>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    const store = getStore();
    const current = await store.getTransaction(businessId, transactionId);
    if (!current) {
      throw new ApiError("NOT_FOUND", "取引が見つかりません");
    }
    if (current.status === "locked") {
      throw new ApiError("FORBIDDEN", "締め済み期間の取引は削除できません");
    }
    if (current.status !== "draft" && actor.role !== "owner") {
      throw new ApiError(
        "FORBIDDEN",
        "確定済みの取引はオーナーのみ削除できます",
      );
    }
    const periods = await store.listFiscalPeriods(businessId);
    assertDateInOpenPeriod(current.date, periods);

    await deleteTransactionDoc(businessId, transactionId);
    await writeAuditLog(businessId, {
      actorUid: actor.uid,
      action: "delete",
      targetPath: `businesses/${businessId}/transactions/${transactionId}`,
    });
    return null;
  });
}
