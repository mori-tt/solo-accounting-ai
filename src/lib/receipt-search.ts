import type { Receipt, Transaction } from "@/lib/accounting/types";
import { normalizeSearchText } from "@/lib/search";

/**
 * 証憑一覧の検索・絞り込み(純粋関数)。
 * 電帳法の検索要件(取引年月日・取引金額・取引先)を証憑単位で満たすため、
 * 証憑自身のメタデータ(transactionDate/amount/counterparty)と
 * 紐付取引の値の両方を検索対象にする。
 * Firestoreに全文検索はないため、取得済みの一覧へこの関数で絞り込む。
 */

export interface ReceiptSearchFilter {
  /** ファイル名・取引先・摘要の部分一致 + 金額の数字部分一致 */
  query?: string;
  /** 取引日の下限(YYYY-MM-DD・この日を含む) */
  startDate?: string;
  /** 取引日の上限(YYYY-MM-DD・この日を含む) */
  endDate?: string;
}

/** 検索対象の取引日一覧(証憑メタデータと紐付取引の双方) */
function receiptDates(receipt: Receipt, tx?: Transaction): string[] {
  return [receipt.transactionDate, tx?.date].filter(
    (d): d is string => typeof d === "string" && d !== "",
  );
}

/** 検索対象の金額一覧(証憑メタデータと紐付取引の双方) */
function receiptAmounts(receipt: Receipt, tx?: Transaction): number[] {
  return [receipt.amount, tx?.amount].filter(
    (a): a is number => typeof a === "number",
  );
}

/** 1トークンが証憑・紐付取引のどれかの項目に一致するか */
function matchesToken(
  receipt: Receipt,
  tx: Transaction | undefined,
  token: string,
): boolean {
  const fields = [
    receipt.fileName,
    receipt.counterparty,
    tx?.counterparty,
    tx?.description,
  ]
    .map((v) => normalizeSearchText(v ?? ""))
    .join(" ");
  if (fields.includes(token)) return true;
  // 金額は数字以外(カンマ・¥・円等)を落として部分一致で比較する
  const digits = token.replace(/\D+/g, "");
  return (
    digits !== "" &&
    receiptAmounts(receipt, tx).some((a) => String(a).includes(digits))
  );
}

/**
 * 証憑が検索条件に一致するか。
 * - キーワードは空白区切りのAND検索。各トークンは
 *   ファイル名/取引先(証憑・紐付取引)/摘要 のどれかに一致すればよい
 * - 日付・金額は証憑メタデータと紐付取引のどちらかが条件を満たせば一致
 *   (紐付け時コピー後に取引が編集されても双方の値で辿れるようにする)
 * - 日付情報を持たない証憑は日付範囲指定時に除外される
 */
export function receiptMatchesFilter(
  receipt: Receipt,
  tx: Transaction | undefined,
  filter: ReceiptSearchFilter,
): boolean {
  const dates = receiptDates(receipt, tx);
  if (filter.startDate && !dates.some((d) => d >= filter.startDate!)) {
    return false;
  }
  if (filter.endDate && !dates.some((d) => d <= filter.endDate!)) {
    return false;
  }
  const tokens = normalizeSearchText(filter.query ?? "")
    .split(" ")
    .filter(Boolean);
  return tokens.every((t) => matchesToken(receipt, tx, t));
}

/** 証憑一覧へのフィルタ適用。txById は紐付取引の解決表 */
export function filterReceipts(
  receipts: readonly Receipt[],
  txById: ReadonlyMap<string, Transaction>,
  filter: ReceiptSearchFilter,
): Receipt[] {
  return receipts.filter((r) =>
    receiptMatchesFilter(
      r,
      r.transactionId ? txById.get(r.transactionId) : undefined,
      filter,
    ),
  );
}
