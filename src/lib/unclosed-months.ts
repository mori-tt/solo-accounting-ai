import { monthKeyOf } from "@/lib/accounting/dates";
import type { FiscalPeriod } from "@/lib/accounting/types";
import { shiftMonthKey } from "@/lib/format";

/**
 * 「前月以前で未締めの月」の件数(ダッシュボードのアラート用)。
 * 締めの単位は会計期間(fiscalPeriods)で、期間は月境界に揃うため
 * 月が closed 期間に含まれればその月は締め済み。対象は次の和集合:
 * - open 期間がカバーする前月以前の月(期間は存在するが未締め)
 * - 取引が存在する前月以前の月(期間未作成でも締め対象の活動がある)
 * 取引も期間も無い月は締めるものが無いため対象外とする。
 */
export function countUnclosedMonths(
  periods: FiscalPeriod[],
  transactionMonthKeys: Iterable<string>,
  currentMonthKey: string,
): number {
  const beforeMonth = shiftMonthKey(currentMonthKey, -1);
  const closedRanges = periods
    .filter((p) => p.status === "closed")
    .map((p) => [monthKeyOf(p.startDate), monthKeyOf(p.endDate)] as const);

  const unclosed = new Set<string>();
  for (const p of periods) {
    if (p.status !== "open") continue;
    const last = monthKeyOf(p.endDate);
    for (
      let mk = monthKeyOf(p.startDate);
      mk <= last && mk <= beforeMonth;
      mk = shiftMonthKey(mk, 1)
    ) {
      unclosed.add(mk);
    }
  }
  for (const mk of transactionMonthKeys) {
    if (mk > beforeMonth) continue;
    const inClosed = closedRanges.some(([s, e]) => mk >= s && mk <= e);
    if (!inClosed) unclosed.add(mk);
  }
  return unclosed.size;
}
