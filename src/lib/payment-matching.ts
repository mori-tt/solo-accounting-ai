import type { InvoiceStatus } from "@/lib/accounting/types";

/**
 * 入金消込(請求書の入金と収入取引の紐付け)の判定ロジック。
 * 画面・Server Action 両側から使うため、副作用のない純粋関数だけを置く。
 * Payment.transactionId は既存フィールド(FIRESTORE_SCHEMA.md)。
 */

export interface PaymentLinkCandidate<T> {
  transaction: T;
  /** counterparty が請求先顧客名と一致するか(候補表示のグルーピング用) */
  sameCustomer: boolean;
}

/**
 * 入金に紐付け候補となる取引を並べる。
 * - 既に他の入金へ紐付いている取引は excludeIds で除く(二重消込の防止)
 * - 同顧客(counterparty一致)を先頭に、あとは日付降順
 * 同顧客以外も残すのは、取引先名が未記入/表記ゆれの取引を拾えるようにするため。
 */
export function rankPaymentLinkCandidates<
  T extends { id: string; date: string; counterparty: string },
>(
  transactions: readonly T[],
  customerName: string,
  excludeIds?: ReadonlySet<string>,
): PaymentLinkCandidate<T>[] {
  return transactions
    .filter((t) => !excludeIds?.has(t.id))
    .map((transaction) => ({
      transaction,
      sameCustomer:
        customerName !== "" && transaction.counterparty === customerName,
    }))
    .sort(
      (a, b) =>
        Number(b.sameCustomer) - Number(a.sameCustomer) ||
        b.transaction.date.localeCompare(a.transaction.date),
    );
}

/** 入金の進捗。draft は入金管理の対象外なので null */
export type InvoicePaymentProgress = "unpaid" | "partial" | "paid";

export function invoicePaymentProgress(
  invoice: { status: InvoiceStatus; totalAmount: number },
  paidAmount: number,
): InvoicePaymentProgress | null {
  if (invoice.status === "draft") return null;
  if (paidAmount <= 0) return "unpaid";
  return paidAmount >= invoice.totalAmount ? "paid" : "partial";
}

/**
 * 消込状態。入金が1件も無ければ null(バッジ非表示)。
 * 全入金が transactionId 付きなら matched、1件でも未紐付けがあれば unmatched。
 */
export function invoiceSettlement(
  payments: readonly { transactionId?: string }[],
): "matched" | "unmatched" | null {
  if (payments.length === 0) return null;
  return payments.every((p) => p.transactionId != null && p.transactionId !== "")
    ? "matched"
    : "unmatched";
}
