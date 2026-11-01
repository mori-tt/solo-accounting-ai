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
import { useAccounts } from "@/lib/hooks/use-accounts";
import { todayDateString } from "@/lib/format";
import type { FiscalPeriod } from "@/lib/accounting/types";
import type { CarriedForwardResult } from "@/lib/accounting/services/periods";
import { openingAccountLabel } from "@/lib/opening-balance-accounts";
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

/** 締め処理の結果(親コンポーネントが保持して結果表示する) */
interface CloseResult {
  periodId: string;
  lockedTransactions: number;
  carriedForward: CarriedForwardResult | null;
}

/**
 * 繰越対象科目の残高表。
 * プリセット資産科目は openingAccountLabel、それ以外(カスタム科目等)は
 * 勘定科目マスタ側のラベル解決にフォールバックする。
 */
function CarryForwardTable({
  balances,
}: {
  balances: readonly { accountCode: string; amount: number }[];
}) {
  const { label } = useAccounts();
  const display = (code: string) => {
    const opening = openingAccountLabel(code);
    return opening === code ? label(code) : opening;
  };
  return (
    <div className="overflow-x-auto">
      <table className={tableClass}>
        <thead>
          <tr>
            <th>勘定科目</th>
            <th className="text-right">期末残高</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.accountCode}>
              <td>{display(b.accountCode)}</td>
              <td className="text-right">
                <Amount value={b.amount} colored />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  onClosed: (result: Omit<CloseResult, "periodId">) => void;
}) {
  const { label } = useAccounts();
  const { data, initialLoading, error, reload } = useApiData(
    () =>
      callApi(() =>
        getClosingChecklist(businessId, period.id, todayDateString()),
      ),
    [businessId, period.id],
  );
  const [confirmClose, setConfirmClose] = useState(false);
  const [carryForward, setCarryForward] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (initialLoading) return <LoadingBlock />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <ErrorState onRetry={reload} />;

  const closed = data.period.status === "closed";
  const carryPreview = data.carryForward;

  const close = async () => {
    setBusy(true);
    setActionError(undefined);
    try {
      const result = await callApi(() =>
        closeFiscalPeriodAction(
          businessId,
          period.id,
          crypto.randomUUID(),
          { carryForward },
        ),
      );
      onClosed(result);
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
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <tbody>
              {data.draftTransactions.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{t.date}</td>
                  <td>{label(t.account)}</td>
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
        </div>
      </Section>

      <Section
        title="領収書未添付の確定済み経費"
        count={data.missingReceiptTransactions.length}
      >
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <tbody>
              {data.missingReceiptTransactions.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">{t.date}</td>
                  <td>{label(t.account)}</td>
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
        </div>
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
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <tbody>
              {data.unpaidExpenses.map((u) => (
                <tr key={u.expense.id}>
                  <td className="whitespace-nowrap">
                    {u.transaction?.date ?? "-"}
                  </td>
                  <td>{label(u.transaction?.account ?? "")}</td>
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
        </div>
      </Section>

      <Section
        title="未入金の請求書"
        count={data.unpaidInvoices.length}
        tone="red"
      >
        <div className="overflow-x-auto">
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
        </div>
      </Section>

      {carryPreview && !closed && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold">
            翌年度への繰越({carryPreview.nextFiscalYear}年度)
          </h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            資産科目の期末残高を帳簿から計算し、
            {carryPreview.nextFiscalYear}
            年度の期首残高として自動生成できます
          </p>
          <CarryForwardTable balances={carryPreview.balances} />
          {carryPreview.nextYearClosed ? (
            <Alert tone="warning" className="mt-3">
              {carryPreview.nextFiscalYear}
              年度はすでに締め済みのため、期首残高の自動生成はできません
            </Alert>
          ) : (
            <>
              {carryPreview.existing.length > 0 && (
                <Alert tone="warning" className="mt-3">
                  {carryPreview.nextFiscalYear}
                  年度の期首残高がすでに{carryPreview.existing.length}
                  件登録されています。繰越を実行すると登録済みの金額は
                  期末残高の計算値で上書きされます。
                </Alert>
              )}
              {isOwner && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={carryForward}
                    onChange={(e) => setCarryForward(e.target.checked)}
                  />
                  締めと同時に{carryPreview.nextFiscalYear}
                  年度の期首残高を自動生成する
                </label>
              )}
            </>
          )}
        </Card>
      )}

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
        message={`${data.period.fiscalYear}年度(${data.period.startDate} 〜 ${data.period.endDate})を締めます。期間内の確定済み取引はすべてロックされ、以後変更できなくなります。${
          carryForward && carryPreview
            ? `${carryPreview.nextFiscalYear}年度の期首残高を期末残高から自動生成します。${
                carryPreview.existing.length > 0
                  ? "登録済みの翌年度期首残高は上書きされます。"
                  : ""
              }`
            : ""
        }この操作は取り消せません。`}
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
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);

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
              onChange={(e) => {
                setPeriodId(e.target.value);
                setCloseResult(null);
              }}
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
          title="会計期間がまだありません"
          description={
            canEdit
              ? "日付を指定して「期間を作成」してください"
              : undefined
          }
        />
      ) : (
        <>
          {closeResult && closeResult.periodId === selected.id && (
            <Card className="mb-4">
              <Alert tone="info">
                締め処理が完了しました。確定済み取引
                {closeResult.lockedTransactions}
                件をロックしました。
              </Alert>
              {closeResult.carriedForward && (
                <div className="mt-3">
                  {closeResult.carriedForward.skippedClosedYear ? (
                    <Alert tone="warning">
                      {closeResult.carriedForward.fiscalYear}
                      年度はすでに締め済みのため、期首残高は生成されませんでした
                    </Alert>
                  ) : (
                    <>
                      <p className="mb-2 text-sm font-semibold">
                        {closeResult.carriedForward.fiscalYear}
                        年度の期首残高を
                        {closeResult.carriedForward.balances.length}
                        件生成しました
                      </p>
                      {closeResult.carriedForward.balances.length === 0 ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          繰越対象の残高がすべて0円のため、期首残高レコードは追加されていません
                        </p>
                      ) : (
                        <CarryForwardTable
                          balances={closeResult.carriedForward.balances}
                        />
                      )}
                      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        内容は
                        <Link
                          href="/opening-balances"
                          className="text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          期首残高
                        </Link>
                        画面で確認・修正できます
                      </p>
                    </>
                  )}
                </div>
              )}
            </Card>
          )}
          <ChecklistBody
            key={`${selected.id}-${reloadKey}`}
            businessId={businessId ?? ""}
            period={selected}
            isOwner={isOwner}
            onClosed={(result) => {
              setCloseResult({ periodId: selected.id, ...result });
              setReloadKey((k) => k + 1);
            }}
          />
        </>
      )}
    </div>
  );
}
