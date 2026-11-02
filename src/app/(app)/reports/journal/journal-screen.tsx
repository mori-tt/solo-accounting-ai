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
                {data.entries.flatMap((e) => {
                  // 源泉徴収対象取引は貸方が複数行(現金+預り金)になるため、
                  // 借方行・貸方行を並べて入力行数だけ行を出す
                  const debits = e.lines.filter((l) => l.debit > 0);
                  const credits = e.lines.filter((l) => l.credit > 0);
                  const rowCount = Math.max(debits.length, credits.length);
                  return Array.from({ length: rowCount }, (_, i) => (
                    <tr key={`${e.transactionId}-${i}`}>
                      <td className="whitespace-nowrap">
                        {i === 0 ? formatDateJP(e.date) : ""}
                      </td>
                      <td>{debits[i] ? label(debits[i].account) : ""}</td>
                      <td className="text-right">
                        {debits[i] && <Amount value={debits[i].debit} />}
                      </td>
                      <td>{credits[i] ? label(credits[i].account) : ""}</td>
                      <td className="text-right">
                        {credits[i] && <Amount value={credits[i].credit} />}
                      </td>
                      <td>
                        {i === 0 && (
                          <>
                            {e.description || "-"}
                            {e.counterparty && (
                              <span className="ml-2 text-xs text-zinc-400">
                                {e.counterparty}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
