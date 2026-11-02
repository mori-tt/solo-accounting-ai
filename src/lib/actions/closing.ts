"use server";

import {
  closeFiscalPeriod,
  closingChecklist,
  ensureFiscalPeriodForDate,
  type CarriedForwardResult,
  type ClosingChecklist,
} from "@/lib/accounting/services/periods";
import type { FiscalPeriod } from "@/lib/accounting/types";
import { run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireOwner, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";

/** 会計期間一覧 */
export async function listFiscalPeriods(
  businessId: string,
): Promise<ActionResult<FiscalPeriod[]>> {
  return run(async () => {
    await requireViewer(businessId);
    const periods = await getStore().listFiscalPeriods(businessId);
    return [...periods].sort((a, b) => b.startDate.localeCompare(a.startDate));
  });
}

/** 指定日を含む会計期間を作成する(既存ならそれを返す) */
export async function ensureFiscalPeriod(
  businessId: string,
  date: string,
): Promise<ActionResult<{ period: FiscalPeriod; created: boolean }>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    return ensureFiscalPeriodForDate(getStore(), businessId, actor, date);
  });
}

/** 締めチェックリスト。asOf は呼び出し側(ユーザーの今日) */
export async function getClosingChecklist(
  businessId: string,
  periodId: string,
  asOf: string,
): Promise<ActionResult<ClosingChecklist>> {
  return run(async () => {
    await requireViewer(businessId);
    return closingChecklist(getStore(), businessId, periodId, asOf);
  });
}

/**
 * 会計期間を締める(オーナーのみ・元に戻せない)。
 * 期間内のconfirmed取引はすべて locked になる。
 * options.carryForward 指定時は翌年度の期首残高も同時に自動生成する。
 */
export async function closeFiscalPeriodAction(
  businessId: string,
  periodId: string,
  idempotencyKey: string,
  options?: { carryForward?: boolean },
): Promise<
  ActionResult<{
    period: FiscalPeriod;
    lockedTransactions: number;
    carriedForward: CarriedForwardResult | null;
  }>
> {
  return run(async () => {
    const actor = await requireOwner(businessId);
    const result = await closeFiscalPeriod(
      getStore(),
      businessId,
      actor,
      periodId,
      idempotencyKey,
      { carryForward: options?.carryForward === true },
    );
    return {
      period: result.period,
      lockedTransactions: result.lockedTransactions,
      carriedForward: result.carriedForward,
    };
  });
}
