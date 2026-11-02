"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createInvoice,
  issueInvoiceAction,
  listCustomers,
  listInvoiceRows,
  listPaymentLinkCandidates,
  listProjects,
  registerPaymentAction,
  type InvoiceRow,
} from "@/lib/actions/sales";
import { callApi } from "@/lib/api-client";
import {
  computeInvoiceTotals,
  invoiceTaxAmount,
} from "@/lib/accounting/invoice-tax";
import type { ConsumptionTaxRate } from "@/lib/accounting/domain/tax";
import type { Transaction } from "@/lib/accounting/types";
import {
  invoicePaymentProgress,
  invoiceSettlement,
} from "@/lib/payment-matching";
import { formatYen, todayDateString } from "@/lib/format";
import {
  invoiceSchema,
  parseForm,
  paymentSchema,
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

interface ItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: ConsumptionTaxRate;
}

function InvoiceForm({
  customers,
  projects,
  busy,
  onSubmit,
  onCancel,
}: {
  customers: { id: string; name: string }[];
  projects: { id: string; name: string; customerId: string }[];
  busy?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { businessId } = useApp();
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [issueDate, setIssueDate] = useState(todayDateString());
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([
    { description: "", quantity: "1", unitPrice: "", taxRate: "standard" },
  ]);
  const [error, setError] = useState<string>();

  const customerProjects = projects.filter((p) => p.customerId === customerId);
  const totals = computeInvoiceTotals(
    items.map((i) => ({
      amount: (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0),
      taxRate: i.taxRate,
    })),
  );

  const setItem = (idx: number, patch: Partial<ItemDraft>) =>
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      customerId,
      projectId: projectId || undefined,
      issueDate,
      dueDate,
      items: items.map((i) => ({
        description: i.description,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        taxRate: i.taxRate,
      })),
    };
    const parsed = parseForm(invoiceSchema, input);
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setError(undefined);
    try {
      await callApi(() =>
        createInvoice(businessId ?? "", {
          ...parsed.data,
          projectId: parsed.data.projectId ?? "",
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="顧客">
          <Select
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setProjectId("");
            }}
            required
          >
            <option value="">選択してください</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="案件(任意)">
          <Select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={!customerId}
          >
            <option value="">案件なし</option>
            {customerProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="発行日">
          <TextInput
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
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

      <div>
        <p className="mb-2 text-xs font-medium text-zinc-500">明細</p>
        {items.map((item, idx) => (
          <div key={idx} className="mb-2 flex items-center gap-2">
            <TextInput
              className="flex-1"
              placeholder="例: デザイン制作費"
              value={item.description}
              onChange={(e) => setItem(idx, { description: e.target.value })}
              required
            />
            <NumberInput
              className="w-24"
              placeholder="数量"
              min={1}
              step={1}
              value={item.quantity}
              onChange={(e) => setItem(idx, { quantity: e.target.value })}
              required
            />
            <NumberInput
              className="w-32"
              placeholder="単価(円)"
              min={0}
              step={1}
              value={item.unitPrice}
              onChange={(e) => setItem(idx, { unitPrice: e.target.value })}
              required
            />
            <Select
              className="w-28"
              value={item.taxRate}
              onChange={(e) =>
                setItem(idx, {
                  taxRate: e.target.value as ConsumptionTaxRate,
                })
              }
              aria-label="税率"
            >
              <option value="standard">10%</option>
              <option value="reduced">軽減8%</option>
            </Select>
            <Button
              type="button"
              variant="ghost"
              disabled={items.length === 1}
              onClick={() =>
                setItems((prev) => prev.filter((_, i) => i !== idx))
              }
            >
              削除
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setItems((prev) => [
              ...prev,
              {
                description: "",
                quantity: "1",
                unitPrice: "",
                taxRate: "standard",
              },
            ])
          }
        >
          明細を追加
        </Button>
        <p className="mt-2 text-right text-sm">
          合計: <Amount value={totals.totalAmount} />
          <span className="text-zinc-400">
            (うち消費税 <Amount value={totals.taxAmount} />)
          </span>
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          請求書を作成(下書き)
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}

function paymentLinkCandidateLabel(t: Transaction): string {
  const counterparty = t.counterparty || "取引先なし";
  const description = t.description ? ` / ${t.description}` : "";
  return `${t.date} / ${counterparty} / ${formatYen(t.amount)}${description}`;
}

/** 入金履歴。消込済みの入金は取引一覧への参照リンクを表示する */
function PaymentHistory({ row }: { row: InvoiceRow }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-zinc-500">入金履歴</p>
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

function PaymentForm({
  row,
  onDone,
}: {
  row: InvoiceRow;
  onDone: () => void;
}) {
  const { businessId } = useApp();
  const [date, setDate] = useState(todayDateString());
  const [amount, setAmount] = useState(String(row.remaining));
  const [transactionId, setTransactionId] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // 紐付け候補(同顧客・発行日以降の収入取引)。取得失敗時は紐付けなしで登録可
  const {
    data: linkData,
    initialLoading: linkLoading,
    error: linkError,
  } = useApiData(
    () =>
      callApi(() =>
        listPaymentLinkCandidates(
          businessId ?? "",
          row.invoice.id,
          todayDateString(),
        ),
      ),
    [businessId, row.invoice.id],
  );
  const sameCustomer = useMemo(
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
      invoiceId: row.invoice.id,
      date,
      amount: Number(amount),
      transactionId: transactionId || undefined,
    };
    const parsed = parseForm(paymentSchema, input);
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    if (parsed.data.amount > row.remaining) {
      setError(
        `入金額が残額(${formatYen(row.remaining)})を超えています`,
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await callApi(() =>
        registerPaymentAction(businessId ?? "", {
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
      {row.payments.length > 0 && <PaymentHistory row={row} />}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="入金日">
          <TextInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <Field label={`入金額(円) / 残額 ${formatYen(row.remaining)}`}>
          <NumberInput
            value={amount}
            min={1}
            step={1}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field
          label="対応する収入取引(任意)"
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
            {sameCustomer.length > 0 && (
              <optgroup label="同顧客の収入取引">
                {sameCustomer.map((c) => (
                  <option key={c.transaction.id} value={c.transaction.id}>
                    {paymentLinkCandidateLabel(c.transaction)}
                  </option>
                ))}
              </optgroup>
            )}
            {otherCandidates.length > 0 && (
              <optgroup
                label={
                  sameCustomer.length > 0
                    ? "その他の収入取引"
                    : "同期間の収入取引"
                }
              >
                {otherCandidates.map((c) => (
                  <option key={c.transaction.id} value={c.transaction.id}>
                    {paymentLinkCandidateLabel(c.transaction)}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Button type="submit" loading={busy}>
          入金を記録
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

export function InvoicesScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [showForm, setShowForm] = useState(false);
  const [payTarget, setPayTarget] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string>();

  const { data, initialLoading, error, reload } = useApiData(async () => {
    const [rows, customers, projects] = await Promise.all([
      callApi(() =>
        listInvoiceRows(businessId ?? "", todayDateString()),
      ),
      callApi(() => listCustomers(businessId ?? "")),
      callApi(() => listProjects(businessId ?? "")),
    ]);
    return { rows, customers, projects };
  }, [businessId]);

  const customerName = useMemo(
    () =>
      new Map((data?.customers ?? []).map((c) => [c.id, c.name] as const)),
    [data],
  );
  const projectName = useMemo(
    () =>
      new Map((data?.projects ?? []).map((p) => [p.id, p.name] as const)),
    [data],
  );

  const issue = async (invoiceId: string) => {
    setBusyIds((s) => new Set(s).add(invoiceId));
    setActionError(undefined);
    try {
      await callApi(() => issueInvoiceAction(businessId ?? "", invoiceId));
      reload();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "発行に失敗しました",
      );
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(invoiceId);
        return n;
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="請求・入金"
        description="請求書の作成・発行と入金の記録を行います"
        actions={
          canEdit ? (
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm ? "閉じる" : "請求書を作成"}
            </Button>
          ) : undefined
        }
      />

      {showForm && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">請求書の作成</h2>
          <InvoiceForm
            customers={data?.customers ?? []}
            projects={data?.projects ?? []}
            onSubmit={() => {
              setShowForm(false);
              reload();
            }}
            onCancel={() => setShowForm(false)}
          />
        </Card>
      )}

      {actionError && (
        <Alert tone="error" className="mb-4">
          {actionError}
        </Alert>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          title="請求書がまだありません"
          description={
            canEdit
              ? data?.customers.length
                ? "「請求書を作成」から下書きを作成してください"
                : "先に顧客一覧で顧客を登録してください"
              : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>請求書番号</th>
                <th>顧客 / 案件</th>
                <th>発行日 / 期日</th>
                <th className="text-right">請求額</th>
                <th className="text-right">入金額 / 残額</th>
                <th>状態</th>
                {canEdit && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const progress = invoicePaymentProgress(
                  row.invoice,
                  row.paidAmount,
                );
                const settlement = invoiceSettlement(row.payments);
                return (
                <Fragment key={row.invoice.id}>
                  <tr>
                    <td className="whitespace-nowrap font-medium">
                      {row.invoice.id}
                    </td>
                    <td>
                      {customerName.get(row.invoice.customerId) ?? "-"}
                      {row.invoice.projectId && (
                        <span className="text-zinc-400">
                          {" "}
                          / {projectName.get(row.invoice.projectId) ?? ""}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {row.invoice.issueDate}
                      <span className="text-zinc-400"> → </span>
                      {row.invoice.dueDate}
                    </td>
                    <td className="text-right">
                      <Amount value={row.invoice.totalAmount} />
                      <div className="text-xs text-zinc-400">
                        うち消費税{" "}
                        <Amount value={invoiceTaxAmount(row.invoice)} />
                      </div>
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
                                historyTarget === row.invoice.id
                                  ? null
                                  : row.invoice.id,
                              );
                            }}
                          >
                            入金履歴({row.payments.length})
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge
                          kind="invoice"
                          status={row.invoice.status}
                        />
                        {progress === "unpaid" && (
                          <Badge tone="gray">未入金</Badge>
                        )}
                        {progress === "partial" && (
                          <Badge tone="amber">一部入金</Badge>
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
                          {row.invoice.status === "draft" && (
                            <Button
                              onClick={() => void issue(row.invoice.id)}
                              loading={busyIds.has(row.invoice.id)}
                            >
                              発行する
                            </Button>
                          )}
                          {(row.invoice.status === "issued" ||
                            row.invoice.status === "overdue") &&
                            row.remaining > 0 && (
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setHistoryTarget(null);
                                  setPayTarget(
                                    payTarget === row.invoice.id
                                      ? null
                                      : row.invoice.id,
                                  );
                                }}
                              >
                                入金を記録
                              </Button>
                            )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {historyTarget === row.invoice.id && (
                    <tr>
                      <td
                        colSpan={canEdit ? 7 : 6}
                        className="bg-zinc-50/70 dark:bg-zinc-800/30"
                      >
                        <PaymentHistory row={row} />
                      </td>
                    </tr>
                  )}
                  {canEdit && payTarget === row.invoice.id && (
                    <tr>
                      <td
                        colSpan={7}
                        className="bg-zinc-50/70 dark:bg-zinc-800/30"
                      >
                        <PaymentForm
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
