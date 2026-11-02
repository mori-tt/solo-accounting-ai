"use client";

import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { useAccounts } from "@/lib/hooks/use-accounts";
import { searchTransactions } from "@/lib/actions/search";
import { callApi } from "@/lib/api-client";
import type { TransactionSearchInput } from "@/lib/validation/schemas";
import {
  Alert,
  Amount,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Select,
  TextInput,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";

const TYPE_LABELS: Record<string, string> = {
  income: "収入",
  expense: "支出",
  transfer: "振替",
};

/** 1回の「さらに読み込み」で追加表示する件数 */
const PAGE_SIZE = 50;

type PeriodPreset = "all" | "year" | "custom";

/** 直近1年の日付範囲(両端含む YYYY-MM-DD) */
function lastYearRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const format = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { startDate: format(start), endDate: format(end) };
}

export function SearchScreen() {
  useBrowserOnly();
  const { businessId } = useApp();
  const { label } = useAccounts();

  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<PeriodPreset>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [formError, setFormError] = useState<string>();
  const [applied, setApplied] = useState<TransactionSearchInput>({ query: "" });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => searchTransactions(businessId ?? "", applied)),
    [businessId, applied],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const range: { startDate?: string; endDate?: string } = {};
    if (period === "year") {
      Object.assign(range, lastYearRange());
    } else if (period === "custom") {
      if (startDate && endDate && startDate > endDate) {
        setFormError("開始日は終了日以前の日付を指定してください");
        return;
      }
      if (startDate) range.startDate = startDate;
      if (endDate) range.endDate = endDate;
    }
    setFormError(undefined);
    setVisibleCount(PAGE_SIZE);
    setApplied({ query: query.trim(), ...range });
  };

  const results = data ?? [];
  const visible = results.slice(0, visibleCount);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="検索"
        description="確定済みの取引を摘要・取引先・科目・金額で横断検索します(下書きは対象外)"
      />

      <form
        onSubmit={submit}
        noValidate
        className="mb-4 flex flex-wrap items-center gap-3"
      >
        <TextInput
          className="w-64"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例: 備品 Amazon 12000"
          aria-label="検索キーワード"
        />
        <Select
          className="w-40"
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodPreset)}
          aria-label="期間"
        >
          <option value="all">全会計期間</option>
          <option value="year">直近1年</option>
          <option value="custom">期間を指定</option>
        </Select>
        {period === "custom" && (
          <>
            <TextInput
              type="date"
              className="w-40"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="開始日"
            />
            <span className="text-sm text-zinc-400">〜</span>
            <TextInput
              type="date"
              className="w-40"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="終了日"
            />
          </>
        )}
        <Button type="submit">検索</Button>
        {data !== undefined && (
          <span className="text-xs text-zinc-400">{results.length}件</span>
        )}
      </form>
      {formError && <Alert tone="error" className="mb-4">{formError}</Alert>}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : results.length === 0 ? (
        <EmptyState
          title="条件に一致する確定済み取引がありません"
          description="キーワードや期間を変更して再度お試しください"
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>日付</th>
                  <th>種別</th>
                  <th>科目</th>
                  <th>取引先 / 摘要</th>
                  <th className="text-right">金額</th>
                  <th>状態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap">{t.date}</td>
                    <td>{TYPE_LABELS[t.type] ?? t.type}</td>
                    <td>{label(t.account)}</td>
                    <td className="max-w-64 truncate">
                      {t.counterparty}
                      {t.description && (
                        <span className="text-zinc-400">
                          {" "}
                          / {t.description}
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      <Amount value={t.amount} />
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusBadge kind="transaction" status={t.status} />
                    </td>
                    <td className="whitespace-nowrap">
                      <Link
                        href="/transactions"
                        className="text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        取引一覧
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {visibleCount < results.length && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                さらに読み込む(残り{results.length - visibleCount}件)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
