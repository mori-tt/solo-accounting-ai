"use client";

import { Button } from "@/components/ui";

/**
 * 会計年度送りナビ(年次レポート・決算書画面で共用)。
 * MonthNav の年度版。開始月が1月以外のときは期間は期間範囲も併記する。
 */
export function YearNav({
  fiscalYear,
  startMonth,
  onChange,
}: {
  /** 会計年度の開始年 */
  fiscalYear: number;
  /** 会計年度開始月(1-12) */
  startMonth: number;
  onChange: (next: number) => void;
}) {
  const label =
    startMonth === 1
      ? `${fiscalYear}年度`
      : `${fiscalYear}年度(${fiscalYear}/${startMonth}〜${fiscalYear + 1}/${startMonth - 1})`;
  return (
    <div className="flex items-center gap-1">
      <Button variant="secondary" onClick={() => onChange(fiscalYear - 1)}>
        ← 前年度
      </Button>
      <span className="min-w-24 text-center text-sm font-medium">
        {label}
      </span>
      <Button variant="secondary" onClick={() => onChange(fiscalYear + 1)}>
        翌年度 →
      </Button>
    </div>
  );
}
