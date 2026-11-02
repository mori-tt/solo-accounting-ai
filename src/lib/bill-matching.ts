import {
  invoiceSettlement,
  rankPaymentLinkCandidates,
  type PaymentLinkCandidate,
} from "@/lib/payment-matching";

/**
 * 支払消込(受領請求書の支払と支出取引の紐付け)の判定ロジック。
 * payment-matching.ts(入金消込)の買掛版。
 * 画面・Server Action 両側から使うため、副作用のない純粋関数だけを置く。
 */

export type BillPaymentLinkCandidate<T> = PaymentLinkCandidate<T>;

/**
 * 支払に紐付け候補となる支出取引を並べる。
 * 入金消込と同じく、既に他の支払へ紐付いている取引は excludeIds で除き、
 * 同じ取引先(counterparty一致)を先頭に、あとは日付降順。
 */
export function rankBillPaymentLinkCandidates<
  T extends { id: string; date: string; counterparty: string },
>(
  transactions: readonly T[],
  vendorName: string,
  excludeIds?: ReadonlySet<string>,
): BillPaymentLinkCandidate<T>[] {
  return rankPaymentLinkCandidates(transactions, vendorName, excludeIds);
}

/** 支払の進捗。bill に draft 状態は無いため null は返さない */
export type BillPaymentProgress = "unpaid" | "partial" | "paid";

export function billPaymentProgress(
  bill: { totalAmount: number },
  paidAmount: number,
): BillPaymentProgress {
  if (paidAmount <= 0) return "unpaid";
  return paidAmount >= bill.totalAmount ? "paid" : "partial";
}

/**
 * 消込状態。支払が1件も無ければ null(バッジ非表示)。
 * 全支払が transactionId 付きなら matched、1件でも未紐付けがあれば unmatched。
 */
export function billSettlement(
  payments: readonly { transactionId?: string }[],
): "matched" | "unmatched" | null {
  return invoiceSettlement(payments);
}
