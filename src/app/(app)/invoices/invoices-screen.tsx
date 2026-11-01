"use client";

import { Fragment, useMemo, useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createInvoice,
  issueInvoiceAction,
  listCustomers,
  listInvoiceRows,
  listProjects,
  registerPaymentAction,
  type InvoiceRow,
} from "@/lib/actions/sales";
import { callApi } from "@/lib/api-client";
import { todayDateString } from "@/lib/format";
import {
  invoiceSchema,
  parseForm,
  paymentSchema,
} from "@/lib/validation/schemas";
import {
  Alert,
  Amount,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
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
    { description: "", quantity: "1", unitPrice: "" },
  ]);
  const [error, setError] = useState<string>();

  const customerProjects = projects.filter((p) => p.customerId === customerId);
  const total = items.reduce(
    (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0),
    0,
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
      })),
    };
    const parsed = parseForm(invoiceSchema, input);
    if (!parsed.success) {
      setError(parsed.issues.join(" / "));
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="顧客">
          <Select
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setProjectId("");
            }}
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
            />
            <NumberInput
              className="w-24"
              placeholder="数量"
              min={1}
              step={1}
              value={item.quantity}
              onChange={(e) => setItem(idx, { quantity: e.target.value })}
            />
            <NumberInput
              className="w-32"
              placeholder="単価(円)"
              min={0}
              step={1}
              value={item.unitPrice}
              onChange={(e) => setItem(idx, { unitPrice: e.target.value })}
            />
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
              { description: "", quantity: "1", unitPrice: "" },
            ])
          }
        >
          明細を追加
        </Button>
        <p className="mt-2 text-right text-sm">
          合計: <Amount value={total} />
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
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      invoiceId: row.invoice.id,
      date,
      amount: Number(amount),
    };
    const parsed = parseForm(paymentSchema, input);
    if (!parsed.success) {
      setError(parsed.issues.join(" / "));
      return;
    }
    if (parsed.data.amount > row.remaining) {
      setError(
        `入金額が残額(${row.remaining.toLocaleString("ja-JP")}円)を超えています`,
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
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Field label="入金日">
        <TextInput
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </Field>
      <Field label={`入金額(円) / 残額 ${row.remaining.toLocaleString("ja-JP")}円`}>
        <NumberInput
          value={amount}
          min={1}
          step={1}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </Field>
      <Button type="submit" loading={busy}>
        入金を記録
      </Button>
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
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

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
    try {
      await callApi(() => issueInvoiceAction(businessId ?? "", invoiceId));
      reload();
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
              {data.rows.map((row) => (
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
                    </td>
                    <td className="text-right">
                      <Amount value={row.paidAmount} />
                      {" / "}
                      <Amount value={row.remaining} />
                    </td>
                    <td>
                      <StatusBadge
                        kind="invoice"
                        status={row.invoice.status}
                      />
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
                                onClick={() =>
                                  setPayTarget(
                                    payTarget === row.invoice.id
                                      ? null
                                      : row.invoice.id,
                                  )
                                }
                              >
                                入金を記録
                              </Button>
                            )}
                        </div>
                      </td>
                    )}
                  </tr>
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
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
