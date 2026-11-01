"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  getMonthlyReport,
  recomputeMonthlyReport,
} from "@/lib/actions/reports";
import { callApi } from "@/lib/api-client";
import { accountLabel } from "@/lib/accounts";
import {
  currentMonthKey,
  formatDateTime,
  formatMonthKey,
} from "@/lib/format";
import {
  Alert,
  Amount,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  MonthNav,
  PageHeader,
  tableClass,
} from "@/components/ui";
import { MonthlyAIExplanation } from "./monthly-ai-explanation";

export function MonthlyReportScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => getMonthlyReport(businessId ?? "", monthKey)),
    [businessId, monthKey],
  );

  const recompute = async () => {
    setBusy(true);
    setActionError(undefined);
    try {
      await callApi(() =>
        recomputeMonthlyReport(businessId ?? "", monthKey),
      );
      reload();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "再計算に失敗しました",
      );
    } finally {
      setBusy(false);
    }
  };

  const rows = data
    ? Object.entries(data.current.accountBreakdown).sort(([a], [b]) =>
        a.localeCompare(b),
      )
    : [];
  const profit = data
    ? data.current.totalIncome - data.current.totalExpense
    : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="月次レポート"
        description="確定済みの取引から集計した月次の収支です"
        actions={
          canEdit ? (
            <Button onClick={() => void recompute()} loading={busy}>
              集計を保存して更新
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <MonthNav monthKey={monthKey} onChange={setMonthKey} />
      </div>

      {actionError && (
        <Alert tone="error" className="mb-4">
          {actionError}
        </Alert>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs text-zinc-500">売上(確定)</p>
              <p className="mt-1 text-2xl font-semibold">
                <Amount value={data.current.totalIncome} />
              </p>
            </Card>
            <Card>
              <p className="text-xs text-zinc-500">経費(確定)</p>
              <p className="mt-1 text-2xl font-semibold">
                <Amount value={data.current.totalExpense} />
              </p>
            </Card>
            <Card>
              <p className="text-xs text-zinc-500">差引損益</p>
              <p className="mt-1 text-2xl font-semibold">
                <Amount value={profit} colored />
              </p>
            </Card>
          </div>

          <Card className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">科目別内訳</h2>
              <p className="text-xs text-zinc-400">
                {data.persisted
                  ? `保存済み集計: ${formatDateTime(data.persisted.computedAt)} 時点`
                  : "この月の集計はまだ保存されていません(表示は現在値)"}
              </p>
            </div>
            {rows.length === 0 ? (
              <EmptyState
                title={`${formatMonthKey(monthKey)}の確定済み取引がありません`}
                description="取引を確定すると科目別の内訳が表示されます"
              />
            ) : (
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th>勘定科目</th>
                    <th className="text-right">収入</th>
                    <th className="text-right">支出</th>
                    <th className="text-right">差引</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([code, v]) => (
                    <tr key={code}>
                      <td>{accountLabel(code)}</td>
                      <td className="text-right">
                        {v.income > 0 ? <Amount value={v.income} /> : "-"}
                      </td>
                      <td className="text-right">
                        {v.expense > 0 ? <Amount value={v.expense} /> : "-"}
                      </td>
                      <td className="text-right">
                        <Amount value={v.income - v.expense} colored />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <MonthlyAIExplanation
            monthKey={monthKey}
            persisted={data.persisted}
            canEdit={canEdit}
          />
        </>
      )}
    </div>
  );
}
