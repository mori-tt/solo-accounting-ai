import { formatDateJP, todayDateString } from "@/lib/format";

/**
 * 印刷時だけ表示する帳票ヘッダ(画面上は hidden)。
 * 帳票名・対象期間・事業名・印刷日を出す。
 * 使い方: 帳票本体の直前に置き、画面側の PageHeader/フィルタは
 * .no-print で囲んで印刷対象から外す。
 */
export function PrintHeader({
  title,
  period,
  businessName,
}: {
  /** 帳票名(例: "仕訳帳") */
  title: string;
  /** 対象期間の表示文字列(例: "2026年11月") */
  period: string;
  businessName?: string;
}) {
  return (
    <div className="print-header print-only hidden">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-lg font-bold">{title}</h1>
        <span className="text-xs">
          印刷日 {formatDateJP(todayDateString())}
        </span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-4 text-xs">
        <span>{businessName}</span>
        <span>対象期間 {period}</span>
      </div>
    </div>
  );
}
