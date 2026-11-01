/**
 * 表示用フォーマット。金額は円単位の整数で保持する(ACCOUNTING_RULES.md)。
 * 通貨単位を明示するため必ずこの関数経由で金額を表示する。
 */

const yenFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

/** 円・整数 → "¥12,000" */
export function formatYen(amount: number): string {
  return yenFormatter.format(amount);
}

/** "YYYY-MM-DD" → "YYYY年M月D日"。不正値はそのまま返す */
export function formatDateJP(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** monthlySummaries のキー "yyyyMM" → "YYYY年M月" */
export function formatMonthKey(monthKey: string): string {
  if (!/^\d{6}$/.test(monthKey)) return monthKey;
  return `${Number(monthKey.slice(0, 4))}年${Number(monthKey.slice(4, 6))}月`;
}

/** ISO 8601 文字列 → "YYYY/M/D HH:MM"(ローカル時刻)。不正値はそのまま返す */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ローカル日付の "YYYY-MM-DD"。フォームの初期値・asOf に使う */
export function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" → monthlySummaries のキー "yyyyMM" */
export function dateToMonthKey(date: string): string {
  return date.slice(0, 4) + date.slice(5, 7);
}

/** 現在月の "yyyyMM" */
export function currentMonthKey(): string {
  return dateToMonthKey(todayDateString());
}

/** monthKey を ±delta 月ずらす */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(4, 6)) - 1 + delta;
  const d = new Date(year, month, 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}`;
}

/** monthKey → その月の日付範囲 {startDate, endDate} */
export function monthKeyDateRange(monthKey: string): {
  startDate: string;
  endDate: string;
} {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(4, 6));
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    startDate: `${year}-${pad(month)}-01`,
    endDate: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}
