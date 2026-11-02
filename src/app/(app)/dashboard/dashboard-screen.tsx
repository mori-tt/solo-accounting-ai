"use client";

import Link from "next/link";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { getDashboard } from "@/lib/actions/reports";
import { callApi, fetchAiUsage } from "@/lib/api-client";
import {
  currentMonthKey,
  formatMonthKey,
  todayDateString,
} from "@/lib/format";
import { useAccounts } from "@/lib/hooks/use-accounts";
import {
  Amount,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-400">{sub}</p>}
    </Card>
  );
}

function AttentionItem({
  href,
  count,
  label,
  danger,
  unit = "件",
}: {
  href: string;
  count: number;
  label: string;
  danger?: boolean;
  unit?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-zinc-800 dark:hover:bg-zinc-800"
    >
      <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
      <Badge tone={count === 0 ? "green" : danger ? "red" : "amber"}>
        {count}
        {unit}
      </Badge>
    </Link>
  );
}

const TYPE_LABELS: Record<string, string> = {
  income: "収入",
  expense: "支出",
  transfer: "振替",
};

export function DashboardScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const { label } = useAccounts();
  const monthKey = currentMonthKey();
  const { data, initialLoading, error, reload } = useApiData(
    () =>
      callApi(() =>
        getDashboard(businessId ?? "", {
          monthKey,
          asOf: todayDateString(),
        }),
      ),
    [businessId, monthKey],
  );
  // AI使用量は補助情報のため独立して取得し、失敗時は非表示にする
  const { data: aiUsage } = useApiData(
    () => fetchAiUsage(businessId ?? ""),
    [businessId],
  );

  if (!businessId) return <LoadingBlock />;
  if (initialLoading) return <LoadingBlock />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ErrorState onRetry={reload} />;

  const profit = data.summary.totalIncome - data.summary.totalExpense;
  const suggestionTargets = new Set(data.pendingSuggestionTransactionIds);
  const allClear =
    data.draftCount === 0 &&
    data.pendingSuggestionCount === 0 &&
    data.unprocessedReceiptCount === 0 &&
    data.unpaidExpenseCount === 0 &&
    data.unpaidInvoiceCount === 0 &&
    data.unclosedMonthCount === 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="ダッシュボード"
        description={`${business?.name ?? ""} / ${formatMonthKey(monthKey)}の状況`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label={`${formatMonthKey(monthKey)}の売上(確定)`}
          value={<Amount value={data.summary.totalIncome} />}
        />
        <SummaryCard
          label={`${formatMonthKey(monthKey)}の経費(確定)`}
          value={<Amount value={data.summary.totalExpense} />}
        />
        <SummaryCard
          label="差引損益"
          value={<Amount value={profit} colored />}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">要対応</h2>
            {aiUsage && (
              <Badge tone={aiUsage.remaining === 0 ? "amber" : "indigo"}>
                今時間のAI提案 残り{aiUsage.remaining}回
              </Badge>
            )}
          </div>
          {allClear ? (
            <p className="py-4 text-center text-sm text-emerald-600 dark:text-emerald-400">
              未処理の項目はありません
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <AttentionItem
                href="/transactions"
                count={data.draftCount}
                label="未確定の取引(下書き)"
              />
              <AttentionItem
                href="/transactions"
                count={data.pendingSuggestionCount}
                label="確認待ちのAI提案"
              />
              <AttentionItem
                href="/receipts"
                count={data.unprocessedReceiptCount}
                label="未処理の領収書"
              />
              <AttentionItem
                href="/expenses/new"
                count={data.unpaidExpenseCount}
                label={`未払の経費(うち期限超過 ${data.overdueExpenseCount}件)`}
                danger={data.overdueExpenseCount > 0}
              />
              <AttentionItem
                href="/invoices"
                count={data.unpaidInvoiceCount}
                label={`未入金の請求書(期限超過 ${data.overdueInvoiceCount}件)`}
                danger={data.overdueInvoiceCount > 0}
              />
              <AttentionItem
                href="/closing"
                count={data.unclosedMonthCount}
                unit="ヶ月"
                label="未締めの月(前月以前)"
              />
              {data.unpaidInvoiceAmount > 0 && (
                <p className="text-right text-xs text-zinc-500">
                  未入金合計: <Amount value={data.unpaidInvoiceAmount} />
                </p>
              )}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">最近の取引</h2>
            <Link
              href="/transactions"
              className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              すべて見る
            </Link>
          </div>
          {data.recentTransactions.length === 0 ? (
            <EmptyState
              title="取引がまだありません"
              description="取引一覧または経費登録から登録してください"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>種別</th>
                    <th>科目</th>
                    <th className="text-right">金額</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTransactions.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap">{t.date}</td>
                      <td>{TYPE_LABELS[t.type] ?? t.type}</td>
                      <td>{label(t.account)}</td>
                      <td className="text-right">
                        <Amount value={t.amount} />
                      </td>
                      <td>
                        <StatusBadge kind="transaction" status={t.status} />
                        {suggestionTargets.has(t.id) && (
                          <span className="ml-1">
                            <Badge tone="indigo">AI</Badge>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
