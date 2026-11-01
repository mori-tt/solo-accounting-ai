"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { getAccountLedgerReport } from "../actions";
import { useBookAccountLabel } from "../account-label";
import { callApi } from "@/lib/api-client";
import {
  currentMonthKey,
  formatDateJP,
  formatMonthKey,
} from "@/lib/format";
import {
  Amount,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  MonthNav,
  PageHeader,
  Select,
  tableClass,
} from "@/components/ui";

export function LedgerScreen() {
  useBrowserOnly();
  const { businessId } = useApp();
  const label = useBookAccountLabel();

  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [account, setAccount] = useState<string>();

  const { data, initialLoading, error, reload } = useApiData(
    () =>
      callApi(() =>
        getAccountLedgerReport(businessId ?? "", monthKey, account),
      ),
    [businessId, monthKey, account],
  );

  const selected = account ?? data?.selected ?? "";
  const ledger = data?.ledger ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="総勘定元帳"
        description="科目ごとの取引明細と残高の推移です"
      />

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <MonthNav monthKey={monthKey} onChange={setMonthKey} />
        <Field label="勘定科目">
          <Select
            className="w-56"
            value={selected}
            onChange={(e) => setAccount(e.target.value)}
            disabled={!data || data.accounts.length === 0}
          >
            {data?.accounts.length === 0 && <option value="">-</option>}
            {data?.accounts.map((code) => (
              <option key={code} value={code}>
                {label(code)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data ? (
        <ErrorState onRetry={reload} />
      ) : !ledger ? (
        <EmptyState
          title="確定済みの取引がありません"
          description="取引を確定すると科目別の元帳が表示されます"
        />
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {label(ledger.account)}
            </h2>
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <Badge tone="gray">
                {ledger.normalBalance === "debit" ? "借方残高" : "貸方残高"}
              </Badge>
              <span>
                期末残高 <Amount value={ledger.closingBalance} />
              </span>
            </div>
          </div>
          <table className={tableClass}>
            <thead>
              <tr>
                <th>日付</th>
                <th>摘要</th>
                <th className="text-right">借方</th>
                <th className="text-right">貸方</th>
                <th className="text-right">残高</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-zinc-500">
                <td>-</td>
                <td>繰越</td>
                <td className="text-right">-</td>
                <td className="text-right">-</td>
                <td className="text-right">
                  <Amount value={ledger.openingBalance} />
                </td>
              </tr>
              {ledger.lines.map((line) => (
                <tr key={`${line.transactionId}-${line.date}`}>
                  <td className="whitespace-nowrap">
                    {formatDateJP(line.date)}
                  </td>
                  <td>
                    {line.description || "-"}
                    {line.counterparty && (
                      <span className="ml-2 text-xs text-zinc-400">
                        {line.counterparty}
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    {line.debit > 0 ? <Amount value={line.debit} /> : "-"}
                  </td>
                  <td className="text-right">
                    {line.credit > 0 ? <Amount value={line.credit} /> : "-"}
                  </td>
                  <td className="text-right">
                    <Amount value={line.balance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ledger.lines.length === 0 && (
            <p className="mt-3 text-xs text-zinc-400">
              {formatMonthKey(monthKey)}の転記はありません(繰越残高のみ)
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
