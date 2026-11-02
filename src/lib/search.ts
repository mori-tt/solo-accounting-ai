import type { Transaction } from "@/lib/accounting/types";

/**
 * 検索・入力履歴サジェスト用の純粋関数。
 * Firestoreには全文検索が無いため、範囲取得した取引へこの関数で絞り込む
 * (actions/search.ts の searchTransactions が呼び出す)。
 */

/**
 * 検索用文字列の正規化。
 * NFKCで全角英数→半角・半角カナ→全角カナへ寄せ、小文字化して
 * 連続空白(全角スペース含む)を1つに畳む。
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** 1トークンが取引のどれかの項目に一致するか */
function matchesToken(
  transaction: Transaction,
  token: string,
  accountLabel: string | undefined,
): boolean {
  const fields = [
    transaction.counterparty,
    transaction.description,
    transaction.account,
    accountLabel ?? "",
  ]
    .map(normalizeSearchText)
    .join(" ");
  if (fields.includes(token)) return true;
  // 金額は数字以外(カンマ・¥・円等)を落として部分一致で比較する
  const digits = token.replace(/\D+/g, "");
  return digits !== "" && String(transaction.amount).includes(digits);
}

/**
 * 空白区切りトークンのAND検索。
 * 各トークンは 摘要/取引先/科目コード/科目名/金額 のどれかに一致すればよい。
 * 空クエリは全件一致(=期間内の確定取引をそのまま一覧する)。
 */
export function transactionMatchesQuery(
  transaction: Transaction,
  query: string,
  accountLabel?: string,
): boolean {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  return tokens.every((token) =>
    matchesToken(transaction, token, accountLabel),
  );
}

/**
 * 直近利用順のdistinct値を返す。
 * values は新しい順(例: 日付降順)に並んだ入力履歴とし、
 * 空文字・重複を除いた先頭 limit 件を返す。フォームのサジェスト用。
 */
export function recentDistinctValues(
  values: readonly (string | undefined)[],
  limit = 100,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}
