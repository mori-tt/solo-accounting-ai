"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createBill,
  listBillPaymentLinkCandidates,
  listBillRows,
  registerBillPaymentAction,
  updateBillAction,
  type BillRow,
} from "@/lib/actions/bills";
import { callApi } from "@/lib/api-client";
import type { Bill, Transaction } from "@/lib/accounting/types";
import { billPaymentProgress, billSettlement } from "@/lib/bill-matching";
import { formatYen, todayDateString } from "@/lib/format";
import {
  billPaymentSchema,
  billSchema,
  parseForm,
} from "@/lib/validation/schemas";
import {
  Alert,
  Amount,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  formIssuesMessage,
  LoadingBlock,
  NumberInput,
  PageHeader,
  Select,
  TextInput,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";

/** 受領請求書の登録・編集フォーム。initial 指定時は編集モード */
function BillForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Bill;
  busy?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { businessId } = useApp();
  const [vendorName, setVendorName] = useState(initial?.vendorName ?? "");
  const [totalAmount, setTotalAmount] = useState(
    initial ? String(initial.totalAmount) : "",
  );
  const [receivedDate, setReceivedDate] = useState(
    initial?.receivedDate ?? todayDateString(),
  );
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      vendorName,
      totalAmount: Number(totalAmount),
      receivedDate,
      dueDate,
      description,
    };
    const parsed = parseForm(billSchema, input);
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setError(undefined);
    try {
      if (initial) {
        await callApi(() =>
          updateBillAction(businessId ?? "", initial.id, parsed.data),
        );
      } else {
        await callApi(() =>
          createBill(businessId ?? "", {
            ...parsed.data,
            idempotencyKey: crypto.randomUUID(),
          }),
        );
      }
      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="取引先">
          <TextInput
            placeholder="例: 〇〇商事株式会社"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            required
          />
        </Field>
        <Field label="請求額(円)">
          <NumberInput
            placeholder="110000"
            min={1}
            step={1}
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="受領日">
          <TextInput
            type="date"
            value={receivedDate}
            onChange={(e) => setReceivedDate(e.target.value)}
            required
          />
        </Field>
        <Field label="支払期日">
          <TextInput
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="摘要(任意)">
        <TextInput
          placeholder="例: 6月分仕入代金"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {initial ? "更新する" : "請求書を登録"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}

function billPaymentLinkCandidateLabel(t: Transaction): string {
  const counterparty = t.counterparty || "取引先なし";
  const description = t.description ? ` / ${t.description}` : "";
  return `${t.date} / ${counterparty} / ${formatYen(t.amount)}${description}`;
}

/** 支払履歴。消込済みの支払は取引一覧への参照リンクを表示する */
function BillPaymentHistory({ row }: { row: BillRow }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-zinc-500">支払履歴</p>
      {row.payments.map((p) => (
        <div
          key={p.id}
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <span className="whitespace-nowrap">{p.date}</span>
          <Amount value={p.amount} />
          {p.transactionId ? (
            <>
              <Badge tone="sky">消込済</Badge>
              <Link
                href="/transactions"
                className="text-xs text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
              >
                取引を参照
              </Link>
            </>
          ) : (
            <Badge tone="amber">未消込</Badge>
          )}
        </div>
      ))}
    </div>
  );
}

function BillPaymentForm({
  row,
  onDone,
}: {
  row: BillRow;
  onDone: () => void;
}) {
  const { businessId } = useApp();
  const [date, setDate] = useState(todayDateString());
  const [amount, setAmount] = useState(String(row.remaining));
  const [transactionId, setTransactionId] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // 紐付け候補(同じ取引先・受領日以降の支出取引)。取得失敗時は紐付けなしで登録可
  const {
    data: linkData,
    initialLoading: linkLoading,
    error: linkError,
  } = useApiData(
    () =>
      callApi(() =>
        listBillPaymentLinkCandidates(
          businessId ?? "",
          row.bill.id,
          todayDateString(),
        ),
      ),
    [businessId, row.bill.id],
  );
  const sameVendor = useMemo(
    () => (linkData?.candidates ?? []).filter((c) => c.sameCustomer),
    [linkData],
  );
  const otherCandidates = useMemo(
    () => (linkData?.candidates ?? []).filter((c) => !c.sameCustomer),
    [linkData],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      billId: row.bill.id,
      date,
      amount: Number(amount),
      transactionId: transactionId || undefined,
    };
    const parsed = parseForm(billPaymentSchema, input);
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    if (parsed.data.amount > row.remaining) {
      setError(
        `支払額が残額(${formatYen(row.remaining)})を超えています`,
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await callApi(() =>
        registerBillPaymentAction(businessId ?? "", {
          ...parsed.data,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      {row.payments.length > 0 && <BillPaymentHistory row={row} />}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="支払日">
          <TextInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <Field label={`支払額(円) / 残額 ${formatYen(row.remaining)}`}>
          <NumberInput
            value={amount}
            min={1}
            step={1}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field
          label="対応する支出取引(任意)"
          hint={
            linkError
              ? "候補を取得できませんでした。紐付けなしで登録できます"
              : undefined
          }
        >
          <Select
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            disabled={linkLoading}
          >
            <option value="">
              {linkLoading ? "候補を読み込み中..." : "紐付けない"}
            </option>
            {sameVendor.length > 0 && (
              <optgroup label="同じ取引先の支出取引">
                {sameVendor.map((c) => (
                  <option key={c.transaction.id} value={c.transaction.id}>
                    {billPaymentLinkCandidateLabel(c.transaction)}
                  </option>
                ))}
              </optgroup>
            )}
            {otherCandidates.length > 0 && (
              <optgroup
                label={
                  sameVendor.length > 0
                    ? "その他の支出取引"
                    : "同期間の支出取引"
                }
              >
                {otherCandidates.map((c) => (
                  <option key={c.transaction.id} value={c.transaction.id}>
                    {billPaymentLinkCandidateLabel(c.transaction)}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Button type="submit" loading={busy}>
          支払を記録
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

export function BillsScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Bill | null>(null);
  const [payTarget, setPayTarget] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<string | null>(null);

  const { data, initialLoading, error, reload } = useApiData(
    () =>
      callApi(() => listBillRows(businessId ?? "", todayDateString())),
    [businessId],
  );

  const overdueCount = useMemo(
    () => (data ?? []).filter((r) => r.overdue).length,
    [data],
  );
  const unpaidTotal = useMemo(
    () =>
      (data ?? [])
        .filter((r) => r.bill.status !== "paid")
        .reduce((s, r) => s + r.remaining, 0),
    [data],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="支払・買掛"
        description="取引先から受領した請求書と支払の記録を行います"
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditTarget(null);
                setShowForm((v) => !v);
              }}
            >
              {showForm && !editTarget ? "閉じる" : "請求書を登録"}
            </Button>
          ) : undefined
        }
      />

      {overdueCount > 0 && (
        <Alert tone="warning" className="mb-4">
          支払期日を過ぎた請求書が {overdueCount} 件あります(未払残額 合計{" "}
          <Amount value={unpaidTotal} />
          )。
        </Alert>
      )}

      {showForm && canEdit && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">
            {editTarget ? "請求書の編集" : "請求書の登録"}
          </h2>
          <BillForm
            initial={editTarget ?? undefined}
            onSubmit={() => {
              setShowForm(false);
              setEditTarget(null);
              reload();
            }}
            onCancel={() => {
              setShowForm(false);
              setEditTarget(null);
            }}
          />
        </Card>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="受領した請求書がまだありません"
          description={
            canEdit
              ? "「請求書を登録」から取引先の請求書を登録してください"
              : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>取引先</th>
                <th>受領日 / 期日</th>
                <th className="text-right">請求額</th>
                <th className="text-right">支払額 / 残額</th>
                <th>状態</th>
                {canEdit && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const progress = billPaymentProgress(
                  row.bill,
                  row.paidAmount,
                );
                const settlement = billSettlement(row.payments);
                return (
                  <Fragment key={row.bill.id}>
                    <tr>
                      <td>
                        {row.bill.vendorName}
                        {row.bill.description && (
                          <span className="block text-xs text-zinc-400">
                            {row.bill.description}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {row.bill.receivedDate}
                        <span className="text-zinc-400"> → </span>
                        <span
                          className={
                            row.overdue
                              ? "font-medium text-red-600 dark:text-red-400"
                              : undefined
                          }
                        >
                          {row.bill.dueDate}
                        </span>
                      </td>
                      <td className="text-right">
                        <Amount value={row.bill.totalAmount} />
                      </td>
                      <td className="text-right">
                        <Amount value={row.paidAmount} />
                        {" / "}
                        <Amount value={row.remaining} />
                        {row.payments.length > 0 && (
                          <div>
                            <button
                              type="button"
                              className="text-xs text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                              onClick={() => {
                                setPayTarget(null);
                                setHistoryTarget(
                                  historyTarget === row.bill.id
                                    ? null
                                    : row.bill.id,
                                );
                              }}
                            >
                              支払履歴({row.payments.length})
                            </button>
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge kind="bill" status={row.bill.status} />
                          {row.overdue && <Badge tone="red">期限超過</Badge>}
                          {progress === "partial" && (
                            <Badge tone="amber">一部支払</Badge>
                          )}
                          {settlement === "unmatched" && (
                            <Badge tone="amber">未消込</Badge>
                          )}
                          {settlement === "matched" && (
                            <Badge tone="sky">消込済</Badge>
                          )}
                        </div>
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap">
                          <div className="flex gap-2">
                            {row.bill.status === "unpaid" && (
                              <>
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    setHistoryTarget(null);
                                    setPayTarget(
                                      payTarget === row.bill.id
                                        ? null
                                        : row.bill.id,
                                    );
                                  }}
                                >
                                  支払を記録
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setPayTarget(null);
                                    setHistoryTarget(null);
                                    setEditTarget(row.bill);
                                    setShowForm(true);
                                  }}
                                >
                                  編集
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {historyTarget === row.bill.id && (
                      <tr>
                        <td
                          colSpan={canEdit ? 6 : 5}
                          className="bg-zinc-50/70 dark:bg-zinc-800/30"
                        >
                          <BillPaymentHistory row={row} />
                        </td>
                      </tr>
                    )}
                    {canEdit && payTarget === row.bill.id && (
                      <tr>
                        <td
                          colSpan={6}
                          className="bg-zinc-50/70 dark:bg-zinc-800/30"
                        >
                          <BillPaymentForm
                            row={row}
                            onDone={() => {
                              setPayTarget(null);
                              reload();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
