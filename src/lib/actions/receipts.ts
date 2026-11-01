"use server";

import {
  archiveReceipt,
  linkReceiptToTransaction,
} from "@/lib/accounting/services/receipts";
import { decideReceiptSuggestion } from "@/lib/accounting/services/aiSuggestions";
import type { Receipt, ReceiptStatus } from "@/lib/accounting/types";
import { run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";

/** 証憑一覧(未処理/紐付済み/アーカイブでフィルタ可) */
export async function listReceipts(
  businessId: string,
  status?: ReceiptStatus,
): Promise<ActionResult<Receipt[]>> {
  return run(async () => {
    await requireViewer(businessId);
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

/** 証憑をアーカイブする(紐付けは外れる) */
export async function archiveReceiptAction(
  businessId: string,
  receiptId: string,
): Promise<ActionResult<Receipt>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { receipt } = await archiveReceipt(
      getStore(),
      businessId,
      actor,
      receiptId,
    );
    return receipt;
  });
}

/** 証憑のAI抽出提案を採用/却下する(確定データへの自動反映はしない) */
export async function decideReceiptSuggestionAction(
  businessId: string,
  receiptId: string,
  decision: "approved" | "rejected",
): Promise<ActionResult<Receipt>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { receipt } = await decideReceiptSuggestion(
      getStore(),
      businessId,
      actor,
      receiptId,
      decision,
    );
    return receipt;
  });
}
