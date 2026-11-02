"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useAccounts } from "@/lib/hooks/use-accounts";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  getFamilySalarySlipReport,
  getPaymentRecordReport,
  listWithholdingRows,
} from "@/lib/actions/withholding";
import { callApi } from "@/lib/api-client";
import { WITHHOLDING_CATEGORY_LABELS } from "@/lib/accounting/domain/withholding";
import { formatDateJP, todayDateString } from "@/lib/format";
import {
  Alert,
  Amount,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { PrintHeader } from "../reports/print-header";

/**
 * 源泉徴収画面。3つのタブで構成する:
 * - 記録一覧: 暦年内の源泉徴収記録とリンク先取引
 * - 支払調書: 報酬・料金等の支払先別年間集計(印刷可)
 * - 源泉徴収票: 専従者給与の年間集計から組み立てる帳票(印刷可)
 * 支払調書・源泉徴収票は暦年(1/1〜12/31)単位のため年ナビは暦年で動かす。
 */

type Tab = "records" | "payment" | "slip";

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "records", label: "記録一覧" },
  { value: "payment", label: "支払調書集計" },
  { value: "slip", label: "源泉徴収票(専従者給与)" },
];

export function WithholdingScreen() {
  useBrowserOnly();
  const { businessId } = useApp();
  const [calendarYear, setCalendarYear] = useState(() =>
    Number(todayDateString().slice(0, 4)),
  );
  const [tab, setTab] = useState<Tab>("records");

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print">
        <PageHeader
          title="源泉徴収"
          description="外注費・報酬の源泉徴収記録と支払調書集計、専従者給与の源泉徴収票を暦年単位で確認できます"
          actions={
            tab !== "records" ? (
              <Button variant="secondary" onClick={() => window.print()}>
                印刷する
              </Button>
            ) : undefined
          }
        />
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              onClick={() => setCalendarYear((y) => y - 1)}
            >
              ← 前年
            </Button>
            <span className="min-w-24 text-center text-sm font-medium">
              {calendarYear}年
            </span>
            <Button
              variant="secondary"
              onClick={() => setCalendarYear((y) => y + 1)}
            >
              翌年 →
            </Button>
          </div>
          <div
            className="flex gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-700"
            role="tablist"
          >
            {TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                onClick={() => setTab(t.value)}
                className={`rounded px-3 py-1 text-sm ${
                  tab === t.value
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "records" && (
        <div className="no-print">
          <RecordsTab businessId={businessId} calendarYear={calendarYear} />
        </div>
      )}
      {tab === "payment" && (
        <PaymentRecordsTab businessId={businessId} calendarYear={calendarYear} />
      )}
      {tab === "slip" && (
        <SalarySlipTab businessId={businessId} calendarYear={calendarYear} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 記録一覧                                                             */
/* ------------------------------------------------------------------ */

function RecordsTab({
  businessId,
  calendarYear,
}: {
  businessId: string | null;
  calendarYear: number;
}) {
  const { label } = useAccounts();
  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => listWithholdingRows(businessId ?? "", calendarYear)),
    [businessId, calendarYear],
  );

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (initialLoading) return <LoadingBlock />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title={`${calendarYear}年の源泉徴収記録はありません`}
        description="支出取引の登録・編集時に「源泉徴収の対象にする」を有効にすると記録されます"
      />
    );
  }
  return (
    <Card className="overflow-x-auto p-0">
      <table className={tableClass}>
        <thead>
          <tr>
            <th>日付</th>
            <th>支払先</th>
            <th>科目</th>
            <th>区分</th>
            <th className="text-right">対象支払額</th>
            <th className="text-right">源泉徴収税額</th>
            <th>計算</th>
            <th>取引状態</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ record, transaction }) => (
            <tr key={record.id}>
              <td className="whitespace-nowrap">
                {transaction ? (
                  <Link
                    href={`/transactions?month=${transaction.date.slice(0, 4)}${transaction.date.slice(5, 7)}&focus=${transaction.id}`}
                    className="text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {transaction.date}
                  </Link>
                ) : (
                  "-"
                )}
              </td>
              <td className="max-w-40 truncate">
                {transaction?.counterparty || "-"}
              </td>
              <td>{label(transaction?.account ?? "")}</td>
              <td>{WITHHOLDING_CATEGORY_LABELS[record.category]}</td>
              <td className="text-right">
                <Amount value={record.paymentAmount} />
              </td>
              <td className="text-right">
                <Amount value={record.taxAmount} />
              </td>
              <td className="whitespace-nowrap">
                {record.calculation === "auto" ? "自動" : "手入力"}
              </td>
              <td>
                {transaction && (
                  <StatusBadge
                    kind="transaction"
                    status={transaction.status}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 支払調書集計                                                          */
/* ------------------------------------------------------------------ */

function PaymentRecordsTab({
  businessId,
  calendarYear,
}: {
  businessId: string | null;
  calendarYear: number;
}) {
  const { data, initialLoading, error, reload } = useApiData(
    () =>
      callApi(() => getPaymentRecordReport(businessId ?? "", calendarYear)),
    [businessId, calendarYear],
  );

  if (error) {
    return (
      <div className="no-print">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }
  if (initialLoading) {
    return (
      <div className="no-print">
        <LoadingBlock />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="no-print">
        <ErrorState onRetry={reload} />
      </div>
    );
  }
  const { report } = data;
  return (
    <>
      {report.excludedCount > 0 && (
        <div className="no-print mb-4">
          <Alert tone="warning">
            下書き・期間外などで集計対象外となった記録が{" "}
            {report.excludedCount} 件あります。確定済みの支出取引のみ集計されます。
          </Alert>
        </div>
      )}
      {report.payees.length === 0 ? (
        <div className="no-print">
          <EmptyState
            title={`${calendarYear}年の支払調書対象の支払いはありません`}
            description="報酬・料金等の区分で源泉徴収を記録した確定済み支出が対象です"
          />
        </div>
      ) : (
        <>
          <PrintHeader
            title="報酬・料金等の支払調書集計"
            period={`${calendarYear}年`}
            businessName={data.businessName}
          />
          <Card className="mb-4 overflow-x-auto p-0">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>支払を受ける者</th>
                  <th className="text-right">件数</th>
                  <th className="text-right">支払金額</th>
                  <th className="text-right">源泉徴収税額</th>
                </tr>
              </thead>
              <tbody>
                {report.payees.map((p) => (
                  <tr key={p.payee}>
                    <td>{p.payee}</td>
                    <td className="text-right">{p.count}</td>
                    <td className="text-right">
                      <Amount value={p.paymentTotal} />
                    </td>
                    <td className="text-right">
                      <Amount value={p.taxTotal} />
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td>合計</td>
                  <td className="text-right">
                    {report.payees.reduce((s, p) => s + p.count, 0)}
                  </td>
                  <td className="text-right">
                    <Amount value={report.totalPayment} />
                  </td>
                  <td className="text-right">
                    <Amount value={report.totalTax} />
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
          {report.payees.map((p) => (
            <Card key={p.payee} className="mb-4 overflow-x-auto p-0">
              <h3 className="border-b border-zinc-200 px-3 py-2 text-sm font-semibold dark:border-zinc-700">
                {p.payee}
              </h3>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th>支払日</th>
                    <th>細目</th>
                    <th className="text-right">支払金額</th>
                    <th className="text-right">源泉徴収税額</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.transactionId}>
                      <td className="whitespace-nowrap">
                        {formatDateJP(r.date)}
                      </td>
                      <td>{r.note || "-"}</td>
                      <td className="text-right">
                        <Amount value={r.paymentAmount} />
                      </td>
                      <td className="text-right">
                        <Amount value={r.taxAmount} />
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={2}>計</td>
                    <td className="text-right">
                      <Amount value={p.paymentTotal} />
                    </td>
                    <td className="text-right">
                      <Amount value={p.taxTotal} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>
          ))}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 源泉徴収票(専従者給与)                                                 */
/* ------------------------------------------------------------------ */

function SalarySlipTab({
  businessId,
  calendarYear,
}: {
  businessId: string | null;
  calendarYear: number;
}) {
  const { data, initialLoading, error, reload } = useApiData(
    () =>
      callApi(() => getFamilySalarySlipReport(businessId ?? "", calendarYear)),
    [businessId, calendarYear],
  );

  if (error) {
    return (
      <div className="no-print">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }
  if (initialLoading) {
    return (
      <div className="no-print">
        <LoadingBlock />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="no-print">
        <ErrorState onRetry={reload} />
      </div>
    );
  }
  const { report } = data;
  return (
    <>
      {report.slips.length === 0 ? (
        <div className="no-print">
          <EmptyState
            title={`${calendarYear}年の専従者給与の支払いはありません`}
            description="専従者給与の科目、または給与区分の源泉徴収を記録した確定済み支出が対象です"
          />
        </div>
      ) : (
        <>
          <PrintHeader
            title="給与所得の源泉徴収票(専従者給与)"
            period={`${calendarYear}年`}
            businessName={data.businessName}
          />
          <div className="no-print mb-4">
            <Alert tone="info">
              年間の確定済み給与支払いから簡易に組み立てた帳票です。
              正式な源泉徴収票の作成には法定様式・扶養控除等の申告内容の確認が必要です。
            </Alert>
          </div>
          {report.slips.map((slip) => (
            <Card key={slip.payee} className="mb-4 break-inside-avoid">
              <h3 className="mb-2 text-center text-base font-bold">
                {calendarYear}年分 給与所得の源泉徴収票
              </h3>
              <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-zinc-500">支払を受ける者</p>
                  <p className="font-medium">{slip.payee}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">支払者</p>
                  <p className="font-medium">{data.issuerName}</p>
                  {data.issuerAddress && (
                    <p className="text-xs text-zinc-500">
                      {data.issuerAddress}
                    </p>
                  )}
                </div>
              </div>
              <table className={`${tableClass} mb-3`}>
                <tbody>
                  <tr>
                    <th className="w-48 text-left">支払金額</th>
                    <td className="text-right">
                      <Amount value={slip.grossAmount} />
                    </td>
                  </tr>
                  <tr>
                    <th className="text-left">給与所得控除後の金額</th>
                    <td className="text-right">
                      <Amount value={slip.netAmount} />
                    </td>
                  </tr>
                  <tr>
                    <th className="text-left">
                      給与所得控除額(算出根拠の内数)
                    </th>
                    <td className="text-right">
                      <Amount value={slip.deductionAmount} />
                    </td>
                  </tr>
                  <tr>
                    <th className="text-left">源泉徴収税額</th>
                    <td className="text-right">
                      <Amount value={slip.taxAmount} />
                    </td>
                  </tr>
                </tbody>
              </table>
              <h4 className="mb-1 text-xs font-semibold text-zinc-500">
                支払明細
              </h4>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th>支払日</th>
                    <th className="text-right">支払金額</th>
                    <th className="text-right">源泉徴収税額</th>
                  </tr>
                </thead>
                <tbody>
                  {slip.rows.map((r) => (
                    <tr key={r.transactionId}>
                      <td className="whitespace-nowrap">
                        {formatDateJP(r.date)}
                      </td>
                      <td className="text-right">
                        <Amount value={r.amount} />
                      </td>
                      <td className="text-right">
                        {r.taxAmount > 0 ? <Amount value={r.taxAmount} /> : "―"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </>
      )}
    </>
  );
}

