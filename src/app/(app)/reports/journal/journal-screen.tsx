"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { getJournalReport } from "../actions";
import { bookAccountLabel } from "../account-label";
import { callApi } from "@/lib/api-client";
import {
  currentMonthKey,
  formatDateJP,
  formatMonthKey,
} from "@/lib/format";
import {
  Amount,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  MonthNav,
  PageHeader,
  tableClass,
} from "@/components/ui";

export function JournalScreen() {
  useBrowserOnly();
  const { businessId } = useApp();

  const [monthKey, setMonthKey] = useState(currentMonthKey());

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => getJournalReport(businessId ?? "", monthKey)),
    [businessId, monthKey],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="仕訳帳"
        description="確定済みの取引を複式仕訳として日付順に表示します"
      />

      <div className="mb-4">
        <MonthNav monthKey={monthKey} onChange={setMonthKey} />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <ErrorState onRetry={reload} />
      ) : data.entries.length === 0 ? (
        <EmptyState
          title={`${formatMonthKey(monthKey)}の確定済み取引がありません`}
          description="取引を確定すると仕訳として表示されます"
        />
      ) : (
        <Card>
          <table className={tableClass}>
            <thead>
              <tr>
                <th>日付</th>
                <th>借方科目</th>
                <th className="text-right">借方金額</th>
                <th>貸方科目</th>
                <th className="text-right">貸方金額</th>
                <th>摘要</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => {
                const [debit, credit] = e.lines;
                return (
                  <tr key={e.transactionId}>
                    <td className="whitespace-nowrap">
                      {formatDateJP(e.date)}
                    </td>
                    <td>{bookAccountLabel(debit.account)}</td>
                    <td className="text-right">
                      <Amount value={debit.debit} />
                    </td>
                    <td>{bookAccountLabel(credit.account)}</td>
                    <td className="text-right">
                      <Amount value={credit.credit} />
                    </td>
                    <td>
                      {e.description || "-"}
                      {e.counterparty && (
                        <span className="ml-2 text-xs text-zinc-400">
                          {e.counterparty}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
