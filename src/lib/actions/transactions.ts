"use server";

import {
  confirmTransaction,
  normalizeTransactionTax,
  registerTransaction,
} from "@/lib/accounting/services/transactions";
import { planWithholdingRecord } from "@/lib/accounting/services/withholding";
import type {
  DeleteOp,
  PutOp,
} from "@/lib/accounting/store/types";
import {
  assertDateInOpenPeriod,
  auditsFor,
} from "@/lib/accounting/services/common";
import { DomainError } from "@/lib/accounting/errors";
import type { Transaction } from "@/lib/accounting/types";
import {
  actionReadRateLimiter,
  actionWriteRateLimiter,
} from "@/lib/api/rate-limit";
import { ApiError, fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { recentDistinctValues } from "@/lib/search";
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
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
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
    actionWriteRateLimiter.consume(businessId);
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
        withholding: parsed.data.withholding ?? undefined,
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
    actionWriteRateLimiter.consume(businessId);
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
      const puts: PutOp[] = [
        {
          collection: "transactions" as const,
          id: transactionId,
          data: next,
        },
      ];
      const deletes: DeleteOp[] = [];
      const audits = auditsFor(
        businessId,
        [{ collection: "transactions", id: transactionId }],
        "update",
        actor,
      );
      // 源泉徴収記録は transactions の付属データとしてライフサイクルを
      // 合わせる。値=更新/新規、null=解除、未指定=保持。
      // expense 以外への種別変更時は記録を削除して不変条件を維持する
      const existingRecord = await tx.getWithholdingRecord(
        businessId,
        transactionId,
      );
      const withholding = parsed.data.withholding;
      if (parsed.data.type !== "expense" || withholding === null) {
        if (existingRecord) {
          deletes.push({
            collection: "withholdingRecords" as const,
            id: transactionId,
          });
          audits.push(
            ...auditsFor(
              businessId,
              [{ collection: "withholdingRecords", id: transactionId }],
              "delete",
              actor,
            ),
          );
        }
      } else if (withholding !== undefined) {
        const record = planWithholdingRecord(
          next,
          withholding,
          actor,
          next.updatedAt,
          existingRecord,
        );
        puts.push({
          collection: "withholdingRecords" as const,
          id: transactionId,
          data: record,
        });
        audits.push(
          ...auditsFor(
            businessId,
            [{ collection: "withholdingRecords", id: transactionId }],
            existingRecord ? "update" : "create",
            actor,
          ),
        );
      }
      return {
        batch: { puts, deletes, audits },
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
    actionWriteRateLimiter.consume(businessId);
    const { transaction } = await confirmTransaction(
      getStore(),
      businessId,
      actor,
      transactionId,
    );
    return transaction;
  });
}

/** 取引の削除(draftのみ・確認ダイアログ必須)。doc削除と監査ログは1トランザクション */
export async function deleteTransaction(
  businessId: string,
  transactionId: string,
): Promise<ActionResult<null>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const store = getStore();
    await store.transact(businessId, {}, async (tx) => {
      const current = await tx.getTransaction(businessId, transactionId);
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
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(current.date, periods);
      // 源泉徴収記録は取引の付属データなので取引と一緒に削除する
      const deletes: DeleteOp[] = [
        { collection: "transactions" as const, id: transactionId },
      ];
      const auditTargets = [{ collection: "transactions", id: transactionId }];
      if (await tx.getWithholdingRecord(businessId, transactionId)) {
        deletes.push({
          collection: "withholdingRecords" as const,
          id: transactionId,
        });
        auditTargets.push({
          collection: "withholdingRecords",
          id: transactionId,
        });
      }
      return {
        batch: {
          puts: [],
          deletes,
          audits: auditsFor(businessId, auditTargets, "delete", actor),
        },
        value: null,
      };
    });
    return null;
  });
}

/** 取引先・摘要の入力履歴。フォームのサジェスト用 */
export interface TransactionInputHistory {
  counterparties: string[];
  descriptions: string[];
}

/**
 * 過去の取引から取引先・摘要のdistinct値を直近利用順で返す。
 * 下書き含む全期間の取引が履歴対象(入力補助なので確定済みに限定しない)。
 */
export async function listTransactionInputHistory(
  businessId: string,
): Promise<ActionResult<TransactionInputHistory>> {
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const transactions = await getStore().listTransactionsInRange(
      businessId,
      "0001-01-01",
      "9999-12-31",
    );
    const byDateDesc = [...transactions].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    return {
      counterparties: recentDistinctValues(
        byDateDesc.map((t) => t.counterparty),
      ),
      descriptions: recentDistinctValues(
        byDateDesc.map((t) => t.description),
      ),
    };
  });
}
