"use server";

import { DomainError } from "@/lib/accounting/errors";
import { auditsFor } from "@/lib/accounting/services/common";
import type { Business, OpeningBalance } from "@/lib/accounting/types";
import { ApiError, fail, run, type ActionResult } from "@/lib/api/result";
import { requireOwner, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { openingBalancesSchema, parseForm } from "@/lib/validation/schemas";

/**
 * 期首残高(business.openingBalances)の参照・更新。
 * 帳簿への反映はドメイン(domain/ledger.ts の仮想仕訳)側が担う。
 */

/** 期首残高一覧(年度・科目コード昇順)。閲覧権限で参照可。 */
export async function getOpeningBalances(
  businessId: string,
): Promise<ActionResult<OpeningBalance[]>> {
  return run(async () => {
    await requireViewer(businessId);
    const business = await getStore().getBusiness(businessId);
    if (!business) {
      throw new ApiError("NOT_FOUND", "事業が見つかりません");
    }
    return [...(business.openingBalances ?? [])].sort(
      (a, b) =>
        a.fiscalYear - b.fiscalYear || a.accountCode.localeCompare(b.accountCode),
    );
  });
}

/** 締め済み年度に属するレコードのみを正規化して比較用に取り出す */
function closedYearKeys(
  balances: readonly OpeningBalance[],
  closedYears: ReadonlySet<number>,
): string[] {
  return balances
    .filter((b) => closedYears.has(b.fiscalYear))
    .map((b) => `${b.fiscalYear}${b.accountCode}${b.amount}`)
    .sort();
}

/**
 * 期首残高の一括保存(オーナーのみ)。
 * businessドキュメントへ配列全体を置き換えて保存する。
 * 締め済み会計年度の期首残高は変更できない(締め済み期間の直接変更禁止)。
 */
export async function saveOpeningBalances(
  businessId: string,
  balances: OpeningBalance[],
): Promise<ActionResult<null>> {
  const parsed = parseForm(openingBalancesSchema, balances);
  if (!parsed.success) {
    return fail("INVALID_INPUT", parsed.issues.join(" / "));
  }
  return run(async () => {
    const actor = await requireOwner(businessId);
    const store = getStore();
    await store.transact(businessId, {}, async (tx) => {
      const current = await tx.getBusiness(businessId);
      if (!current) {
        throw new ApiError("NOT_FOUND", "事業が見つかりません");
      }
      const periods = await tx.listFiscalPeriods(businessId);
      const closedYears = new Set(
        periods.filter((p) => p.status === "closed").map((p) => p.fiscalYear),
      );
      if (closedYears.size > 0) {
        const before = closedYearKeys(current.openingBalances ?? [], closedYears);
        const after = closedYearKeys(parsed.data, closedYears);
        const changed =
          before.length !== after.length ||
          before.some((key, i) => key !== after[i]);
        if (changed) {
          throw new DomainError(
            "PERIOD_CLOSED",
            `opening balances for closed fiscal year are immutable`,
          );
        }
      }
      const next: Business = {
        ...current,
        openingBalances: parsed.data,
        updatedAt: new Date().toISOString(),
      };
      return {
        batch: {
          puts: [
            { collection: "businesses" as const, id: businessId, data: next },
          ],
          audits: auditsFor(
            businessId,
            [{ collection: "businesses", id: businessId }],
            "update",
            actor,
          ),
        },
        value: null,
      };
    });
    return null;
  });
}
