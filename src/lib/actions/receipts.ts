"use server";

import {
  archiveReceipt,
  linkReceiptToTransaction,
  updateReceiptMetadata,
} from "@/lib/accounting/services/receipts";
import type { Receipt, ReceiptStatus } from "@/lib/accounting/types";
import {
  actionReadRateLimiter,
  actionWriteRateLimiter,
} from "@/lib/api/rate-limit";
import { fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  parseForm,
  receiptMetadataSchema,
  type ReceiptMetadataFormInput,
} from "@/lib/validation/schemas";

/** 証憑一覧(未処理/紐付済み/アーカイブでフィルタ可) */
export async function listReceipts(
  businessId: string,
  status?: ReceiptStatus,
): Promise<ActionResult<Receipt[]>> {
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    return getStore().listReceipts(businessId, status);
  });
}

/** 証憑を取引に紐付ける */
export async function linkReceipt(
  businessId: string,
  receiptId: string,
  transactionId: string,
): Promise<ActionResult<Receipt>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { receipt } = await linkReceiptToTransaction(
      getStore(),
      businessId,
      actor,
      receiptId,
      transactionId,
    );
    return receipt;
  });
}

/**
 * 証憑の検索用メタデータ(取引日/金額/取引先)を更新する。
 * 空文字・null入力は対応フィールドの削除。
 */
export async function updateReceiptMetadataAction(
  businessId: string,
  receiptId: string,
  input: ReceiptMetadataFormInput,
): Promise<ActionResult<Receipt>> {
  const parsed = parseForm(receiptMetadataSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { receipt } = await updateReceiptMetadata(
      getStore(),
      businessId,
      actor,
      receiptId,
      {
        transactionDate: parsed.data.transactionDate || undefined,
        amount: parsed.data.amount ?? undefined,
        counterparty: parsed.data.counterparty.trim() || undefined,
      },
    );
    return receipt;
  });
}

/** 証憑をアーカイブする(紐付けは外れる) */
export async function archiveReceiptAction(
  businessId: string,
  receiptId: string,
): Promise<ActionResult<Receipt>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { receipt } = await archiveReceipt(
      getStore(),
      businessId,
      actor,
      receiptId,
    );
    return receipt;
  });
}
