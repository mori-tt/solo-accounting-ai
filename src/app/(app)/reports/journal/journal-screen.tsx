"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { getJournalReport } from "../actions";
import { useBookAccountLabel } from "../account-label";
import { callApi } from "@/lib/api-client";
import {
  currentMonthKey,
  formatDateJP,
  formatMonthKey,
} from "@/lib/format";
import {
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
import { PrintHeader } from "../print-header";

export function JournalScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const label = useBookAccountLabel();

  const [monthKey, setMonthKey] = useState(currentMonthKey());

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => getJournalReport(businessId ?? "", monthKey)),
    [businessId, monthKey],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print">
        <PageHeader
          title="仕訳帳"
          description="確定済みの取引を複式仕訳として日付順に表示します"
          actions={
            <Button
              variant="secondary"
              onClick={() => window.print()}
              disabled={!data || data.entries.length === 0}
            >
              印刷する
            </Button>
          }
        />

        <div className="mb-4">
          <MonthNav monthKey={monthKey} onChange={setMonthKey} />
        </div>
      </div>

      {error ? (
        <div className="no-print">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : initialLoading ? (
        <div className="no-print">
          <LoadingBlock />
        </div>
      ) : !data ? (
        <div className="no-print">
          <ErrorState onRetry={reload} />
        </div>
      ) : data.entries.length === 0 ? (
        <div className="no-print">
          <EmptyState
            title={`${formatMonthKey(monthKey)}の確定済み取引がありません`}
            description="取引を確定すると仕訳として表示されます"
          />
        </div>
      ) : (
        <>
          <PrintHeader
            title="仕訳帳"
            period={formatMonthKey(monthKey)}
            businessName={business?.name}
          />
          <Card className="print-sheet">
            <table className={`${tableClass} print-table`}>
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
                      <td>{label(debit.account)}</td>
                      <td className="text-right">
                        <Amount value={debit.debit} />
                      </td>
                      <td>{label(credit.account)}</td>
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
        </>
      )}
    </div>
  );
}
