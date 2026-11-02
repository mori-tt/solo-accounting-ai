"use server";

import { getAccountOptions } from "@/lib/accounts";
import type { Transaction } from "@/lib/accounting/types";
import { fail, run, type ActionResult } from "@/lib/api/result";
import { requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { transactionMatchesQuery } from "@/lib/search";
import {
  parseForm,
  transactionSearchSchema,
  type TransactionSearchInput,
} from "@/lib/validation/schemas";

/**
 * 確定済み取引の横断検索(摘要・取引先・科目・金額)。
 * 期間未指定は全会計期間。businessIdスコープは requireViewer が担保し、
 * draftは対象外(confirmed/lockedのみ)。日付降順で返す。
 */
export async function searchTransactions(
  businessId: string,
  input: TransactionSearchInput,
): Promise<ActionResult<Transaction[]>> {
  const parsed = parseForm(transactionSearchSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    await requireViewer(businessId);
    const store = getStore();
    const [transactions, business] = await Promise.all([
      store.listTransactionsInRange(
        businessId,
        parsed.data.startDate ?? "0001-01-01",
        parsed.data.endDate ?? "9999-12-31",
      ),
      store.getBusiness(businessId),
    ]);
    // 科目コード→表示名(標準科目+カスタム科目)を引いて科目名検索に使う
    const labels = new Map(
      getAccountOptions(business).map((a) => [a.code, a.label]),
    );
    return transactions
      .filter((t) => t.status !== "draft")
      .filter((t) =>
        transactionMatchesQuery(t, parsed.data.query, labels.get(t.account)),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  });
}
