"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  closeFiscalPeriodAction,
  ensureFiscalPeriod,
  getClosingChecklist,
  listFiscalPeriods,
} from "@/lib/actions/closing";
import { callApi } from "@/lib/api-client";
import { accountLabel } from "@/lib/accounts";
import { todayDateString } from "@/lib/format";
import type { FiscalPeriod } from "@/lib/accounting/types";
import {
  Alert,
  Amount,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Select,
  TextInput,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone?: "red" | "amber";
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge tone={count === 0 ? "green" : (tone ?? "amber")}>
          {count}件
        </Badge>
      </div>
      {count === 0 ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          問題ありません
        </p>
      ) : (
        children
      )}
    </Card>
  );
}

function ChecklistBody({
  businessId,
  period,
  isOwner,
  onClosed,
}: {
  businessId: string;
  period: FiscalPeriod;
  isOwner: boolean;
  onClosed: () => void;
}) {
  const { data, initialLoading, error, reload } = useApiData(
    () =>
      callApi(() =>
        getClosingChecklist(businessId, period.id, todayDateString()),
      ),
    [businessId, period.id],
  );
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (initialLoading) return <LoadingBlock />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ErrorState message="取得に失敗しました" onRetry={reload} />;

  const closed = data.period.status === "closed";

  const close = async () => {
    setBusy(true);
    setActionError(undefined);
    try {
      await callApi(() =>
        closeFiscalPeriodAction(businessId, period.id, crypto.randomUUID()),
      );
      onClosed();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "締め処理に失敗しました",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">
              {data.period.fiscalYear}年度 会計期間
            </p>
            <p className="text-xs text-zinc-500">
              {data.period.startDate} 〜 {data.period.endDate}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge kind="period" status={data.period.status} />
            {closed && data.period.closedAt && (
              <span className="text-xs text-zinc-400">
                {data.period.closedAt.slice(0, 10)} に締め済み
              </span>
            )}
          </div>
        </div>
        {closed ? (
          <Alert tone="info" className="mt-3">
            この期間は締め済みです。期間内のデータは変更できません。
          </Alert>
        ) : !data.canClose ? (
          <Alert tone="warning" className="mt-3">
            下書きの取引が残っているため締められません。先に確定または削除してください。
          </Alert>
        ) : (
          <Alert tone="info" className="mt-3">
            締め可能です。締めると期間内の確定済み取引がすべてロックされます。
          </Alert>
        )}
      </Card>

      <Section
        title="未確定の取引(下書き)"
        count={data.draftTransactions.length}
        tone="red"
      >
        <table className={tableClass}>
          <tbody>
            {data.draftTransactions.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap">{t.date}</td>
                <td>{accountLabel(t.account)}</td>
                <td className="text-right">
                  <Amount value={t.amount} />
                </td>
                <td>
                  <Link
                    href="/transactions"
                    className="text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    取引一覧で確定する
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="証憑未添付の確定済み経費"
        count={data.missingReceiptTransactions.length}
      >
        <table className={tableClass}>
          <tbody>
            {data.missingReceiptTransactions.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap">{t.date}</td>
                <td>{accountLabel(t.account)}</td>
                <td className="text-right">
                  <Amount value={t.amount} />
                </td>
                <td>
                  <Link
                    href="/receipts"
                    className="text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    領収書を紐付ける
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="未処理の領収書"
        count={data.unprocessedReceiptIds.length}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          未処理の領収書が{data.unprocessedReceiptIds.length}
          件あります。{" "}
          <Link
            href="/receipts"
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            領収書確認へ
          </Link>
        </p>
      </Section>

      <Section
        title="未払の経費"
        count={data.unpaidExpenses.length}
        tone="red"
      >
        <table className={tableClass}>
          <tbody>
            {data.unpaidExpenses.map((u) => (
              <tr key={u.expense.id}>
                <td className="whitespace-nowrap">
                  {u.transaction?.date ?? "-"}
                </td>
                <td>{accountLabel(u.transaction?.account ?? "")}</td>
                <td>{u.expense.paymentDueDate ?? "期日未設定"}</td>
                <td className="text-right">
                  {u.transaction && <Amount value={u.transaction.amount} />}
                </td>
                <td>
                  {u.overdue ? (
                    <Badge tone="red">期限超過</Badge>
                  ) : (
                    <Badge tone="amber">未払</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="未入金の請求書"
        count={data.unpaidInvoices.length}
        tone="red"
      >
        <table className={tableClass}>
          <tbody>
            {data.unpaidInvoices.map((u) => (
              <tr key={u.invoice.id}>
                <td className="whitespace-nowrap">{u.invoice.id}</td>
                <td>{u.invoice.dueDate}</td>
                <td className="text-right">
                  <Amount value={u.remaining} />
                </td>
                <td>
                  {u.overdue ? (
                    <Badge tone="red">期限超過</Badge>
                  ) : (
                    <Badge tone="amber">未入金</Badge>
                  )}
                </td>
                <td>
                  <Link
                    href="/invoices"
                    className="text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    入金を記録する
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {actionError && <Alert tone="error">{actionError}</Alert>}

      {isOwner && !closed && (
        <div>
          <Button
            variant="danger"
            disabled={!data.canClose}
            onClick={() => setConfirmClose(true)}
          >
            この期間を締める
          </Button>
          {!data.canClose && (
            <p className="mt-1 text-xs text-zinc-400">
              下書き取引を処理すると締められるようになります
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmClose}
        title="会計期間の締め"
        message={`${data.period.fiscalYear}年度(${data.period.startDate} 〜 ${data.period.endDate})を締めます。期間内の確定済み取引はすべてロックされ、以後変更できなくなります。この操作は取り消せません。`}
        confirmLabel="締めを実行する"
        loading={busy}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          void close();
        }}
      />
    </div>
  );
}

export function ClosingScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";
  const isOwner = business?.role === "owner";

  const [periodId, setPeriodId] = useState("");
  const [ensureDate, setEnsureDate] = useState(todayDateString());
  const [ensureBusy, setEnsureBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

  const { data: periods, initialLoading, error, reload } = useApiData(
    () => callApi(() => listFiscalPeriods(businessId ?? "")),
    [businessId, reloadKey],
  );

  const selected = useMemo(
    () => periods?.find((p) => p.id === periodId) ?? periods?.[0],
    [periods, periodId],
  );

  const ensure = async () => {
    setEnsureBusy(true);
    setActionError(undefined);
    try {
      const res = await callApi(() =>
        ensureFiscalPeriod(businessId ?? "", ensureDate),
      );
      reload();
      setPeriodId(res.period.id);
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "期間の作成に失敗しました",
      );
    } finally {
      setEnsureBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="決算チェック"
        description="期間締めの前に、未処理項目がないか確認します"
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="対象期間">
            <Select
              className="w-64"
              value={selected?.id ?? ""}
              onChange={(e) => setPeriodId(e.target.value)}
            >
              {(periods ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fiscalYear}年度 {p.startDate}〜{p.endDate}
                  {p.status === "closed" ? "(締め済み)" : ""}
                </option>
              ))}
              {(periods ?? []).length === 0 && (
                <option value="">期間がありません</option>
              )}
            </Select>
          </Field>
          {canEdit && (
            <>
              <Field label="指定日を含む期間を作成">
                <TextInput
                  type="date"
                  value={ensureDate}
                  onChange={(e) => setEnsureDate(e.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={() => void ensure()}
                loading={ensureBusy}
              >
                期間を作成
              </Button>
            </>
          )}
        </div>
        {actionError && (
          <Alert tone="error" className="mt-3">
            {actionError}
          </Alert>
        )}
      </Card>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !selected ? (
        <EmptyState
          title="会計期間がありません"
          description={
            canEdit
              ? "日付を指定して「期間を作成」してください"
              : undefined
          }
        />
      ) : (
        <ChecklistBody
          key={`${selected.id}-${reloadKey}`}
          businessId={businessId ?? ""}
          period={selected}
          isOwner={isOwner}
          onClosed={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
