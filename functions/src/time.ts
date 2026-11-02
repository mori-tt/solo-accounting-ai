/** Cloud Scheduler 実行の基準タイムゾーン(日本の個人事業主向け) */
export const SCHEDULE_TIME_ZONE = "Asia/Tokyo";

/**
 * 指定タイムゾーンでの現在日付を YYYY-MM-DD で返す。
 * UTC時刻と日付がずれる月またぎ判定のため、サーバー時刻ではなく
 * このタイムゾーン基準で「今日」を決める。
 */
export function todayInTimeZone(
  timeZone: string = SCHEDULE_TIME_ZONE,
  now: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone }).format(now);
}
