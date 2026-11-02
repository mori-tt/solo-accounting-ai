import type { TaxMode } from "../types";
import {
  assertISODate,
  daysBetween,
  pad2,
  toUTCEpoch,
  type ISODate,
} from "./dates";

/**
 * 申告期限アラート(ダッシュボード表示用)の計算。
 * 個人事業主の主な法定申告期限をカバーする:
 * - 確定申告(所得税・復興特別所得税): 毎年3/15
 * - 消費税の申告・納付: 毎年3/31(課税事業者のみ。免税事業者は対象外)
 * - 償却資産の申告(市町村への償却資産申告書): 毎年1/31(対象資産がある場合のみ)
 *
 * 個人の課税期間は暦年固定のため、事業の会計年度開始月には依存しない。
 * 期限日が土曜・日曜の場合は翌月曜日に読み替える
 * (通則法の「休日等の翌日」ルール。国民の祝日・年末年始の
 * 行政休日は考慮しない簡易版)。
 */

/** 期限日の何日前からアラートを出すか */
export const FILING_ALERT_AHEAD_DAYS = 30;
/**
 * 期限超過後もアラートを出し続ける猶予日数。
 * 申告済みかどうかをシステムが知らないため、無期限に
 * 「期限超過」を出し続けると誤表示になる。猶予を過ぎたら
 * 対応済みとみなして表示を終える。
 */
export const FILING_ALERT_OVERDUE_DAYS = 30;

export type FilingDeadlineKind =
  | "income_tax"
  | "consumption_tax"
  | "depreciable_assets";

export interface FilingDeadlineAlert {
  kind: FilingDeadlineKind;
  /** 表示名(例: 確定申告(所得税)) */
  label: string;
  /** 曜日調整後の申告期限日 */
  dueDate: ISODate;
  /** asOf → dueDate の日数。0=当日、負=期限超過日数 */
  daysUntil: number;
  /** upcoming=期限接近中(当日含む) / overdue=期限超過(猶予内) */
  state: "upcoming" | "overdue";
}

/** 期限判定に必要な事業コンテキスト */
export interface FilingDeadlineContext {
  /** 基準日 YYYY-MM-DD(通常は今日) */
  asOf: ISODate;
  /** 事業の消費税課税方式。exempt なら消費税申告は対象外 */
  taxMode: TaxMode;
  /** 償却資産(固定資産)を保有していれば償却資産申告が対象 */
  hasDepreciableAssets: boolean;
}

interface FilingDeadlineDef {
  kind: FilingDeadlineKind;
  label: string;
  /** 法定の基準月日(曜日調整前) */
  month: number;
  day: number;
  applies: (ctx: FilingDeadlineContext) => boolean;
}

const FILING_DEADLINES: readonly FilingDeadlineDef[] = [
  {
    kind: "depreciable_assets",
    label: "償却資産の申告",
    month: 1,
    day: 31,
    applies: (ctx) => ctx.hasDepreciableAssets,
  },
  {
    kind: "income_tax",
    label: "確定申告(所得税)",
    month: 3,
    day: 15,
    applies: () => true,
  },
  {
    kind: "consumption_tax",
    label: "消費税の申告・納付",
    month: 3,
    day: 31,
    applies: (ctx) => ctx.taxMode !== "exempt",
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: ISODate, days: number): ISODate {
  return new Date(toUTCEpoch(date) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * 基準月日から指定年の期限日を求める。
 * 期限が土曜・日曜に当たる場合は翌月曜日へ繰り下げる。
 */
function adjustedDueDate(year: number, month: number, day: number): ISODate {
  const base = `${year}-${pad2(month)}-${pad2(day)}` as ISODate;
  const dow = new Date(toUTCEpoch(base)).getUTCDay();
  if (dow === 6) return addDays(base, 2);
  if (dow === 0) return addDays(base, 1);
  return base;
}

/**
 * asOf 時点で表示すべき申告期限アラートを期限日昇順で返す。
 * - 期限の AHEAD_DAYS 日前から表示し、当日は daysUntil=0
 * - 期限超過は OVERDUE_DAYS 日の猶予内のみ表示(state=overdue)
 * - 表示対象は直近の期限1件のみ(窓が狭いため年またぎの重複は起きない)
 */
export function filingDeadlineAlerts(
  ctx: FilingDeadlineContext,
): FilingDeadlineAlert[] {
  assertISODate(ctx.asOf, "asOf");
  const year = Number(ctx.asOf.slice(0, 4));
  const alerts: FilingDeadlineAlert[] = [];
  for (const def of FILING_DEADLINES) {
    if (!def.applies(ctx)) continue;
    for (const y of [year - 1, year, year + 1]) {
      const dueDate = adjustedDueDate(y, def.month, def.day);
      const daysUntil = daysBetween(ctx.asOf, dueDate);
      if (
        daysUntil > FILING_ALERT_AHEAD_DAYS ||
        daysUntil < -FILING_ALERT_OVERDUE_DAYS
      ) {
        continue;
      }
      alerts.push({
        kind: def.kind,
        label: def.label,
        dueDate,
        daysUntil,
        state: daysUntil < 0 ? "overdue" : "upcoming",
      });
    }
  }
  return alerts.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
