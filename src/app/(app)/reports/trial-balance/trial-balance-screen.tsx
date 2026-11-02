"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { getTrialBalanceReport } from "../actions";
import { useBookAccountLabel } from "../account-label";
import { callApi } from "@/lib/api-client";
import { currentMonthKey, formatMonthKey } from "@/lib/format";
import {
  Alert,
  Amount,
  Badge,
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

export function TrialBalanceScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const label = useBookAccountLabel();

  const [monthKey, setMonthKey] = useState(currentMonthKey());

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => getTrialBalanceReport(businessId ?? "", monthKey)),
    [businessId, monthKey],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print">
        <PageHeader
          title="試算表"
          description="確定済みの取引から科目別の借方・貸方合計を集計します"
          actions={
            <Button
              variant="secondary"
              onClick={() => window.print()}
              disabled={!data || data.rows.length === 0}
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
      ) : data.rows.length === 0 ? (
        <div className="no-print">
          <EmptyState
            title={`${formatMonthKey(monthKey)}の確定済み取引がありません`}
            description="取引を確定すると試算表に集計されます"
          />
        </div>
      ) : (
        <>
          <PrintHeader
            title="試算表"
            period={formatMonthKey(monthKey)}
            businessName={business?.name}
          />
          <Card className="print-sheet">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {formatMonthKey(monthKey)}の試算表
              </h2>
              {data.balanced ? (
                <Badge tone="green">貸借一致</Badge>
              ) : (
                <Badge tone="red">貸借不一致</Badge>
              )}
            </div>
            {!data.balanced && (
              <Alert tone="error" className="mb-3">
                借方合計と貸方合計が一致していません
              </Alert>
            )}
            <table className={`${tableClass} print-table`}>
              <thead>
                <tr>
                  <th>勘定科目</th>
                  <th className="text-right">借方合計</th>
                  <th className="text-right">貸方合計</th>
                  <th className="text-right">残高</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.account}>
                    <td>{label(row.account)}</td>
                    <td className="text-right">
                      <Amount value={row.debitTotal} />
                    </td>
                    <td className="text-right">
                      <Amount value={row.creditTotal} />
                    </td>
                    <td className="text-right">
                      <Amount value={row.balance} colored />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td>合計</td>
                  <td className="text-right">
                    <Amount value={data.debitTotal} />
                  </td>
                  <td className="text-right">
                    <Amount value={data.creditTotal} />
                  </td>
                  <td className="text-right">
                    <Amount value={data.debitTotal - data.creditTotal} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
