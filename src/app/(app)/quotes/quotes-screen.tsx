"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  convertQuoteAction,
  createQuote,
  listQuoteRows,
  markQuoteAcceptedAction,
  markQuoteSentAction,
  updateQuoteAction,
} from "@/lib/actions/quotes";
import { listCustomers, listProjects } from "@/lib/actions/sales";
import { callApi } from "@/lib/api-client";
import { computeInvoiceTotals } from "@/lib/accounting/invoice-tax";
import type { ConsumptionTaxRate } from "@/lib/accounting/domain/tax";
import type { Quote } from "@/lib/accounting/types";
import { todayDateString } from "@/lib/format";
import { parseForm, quoteSchema } from "@/lib/validation/schemas";
import {
  Alert,
  Amount,
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
import { QuoteSheet } from "./quote-sheet";

interface ItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: ConsumptionTaxRate;
}

const EMPTY_ITEM: ItemDraft = {
  description: "",
  quantity: "1",
  unitPrice: "",
  taxRate: "standard",
};

function toItemDrafts(quote: Quote): ItemDraft[] {
  return quote.items.map((i) => ({
    description: i.description,
    quantity: String(i.quantity),
    unitPrice: String(i.unitPrice),
    taxRate: i.taxRate ?? "standard",
  }));
}

function QuoteForm({
  customers,
  projects,
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  customers: { id: string; name: string }[];
  projects: { id: string; name: string; customerId: string }[];
  /** 編集時の初期値(作成時は undefined) */
  initial?: Quote;
  busy?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { businessId } = useApp();
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [issueDate, setIssueDate] = useState(
    initial?.issueDate ?? todayDateString(),
  );
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<ItemDraft[]>(
    initial ? toItemDrafts(initial) : [EMPTY_ITEM],
  );
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
      validUntil,
      items: items.map((i) => ({
        description: i.description,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        taxRate: i.taxRate,
      })),
      notes: notes || undefined,
    };
    const parsed = parseForm(quoteSchema, input);
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setError(undefined);
    try {
      if (initial) {
        await callApi(() =>
          updateQuoteAction(businessId ?? "", initial.id, {
            ...parsed.data,
            projectId: parsed.data.projectId ?? "",
          }),
        );
      } else {
        await callApi(() =>
          createQuote(businessId ?? "", {
            ...parsed.data,
            projectId: parsed.data.projectId ?? "",
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
        <Field label="有効期限">
          <TextInput
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
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
          onClick={() => setItems((prev) => [...prev, EMPTY_ITEM])}
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

      <Field label="備考(任意・帳票の備考欄に表示)">
        <TextInput
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例: お支払条件・作業範囲の補足"
        />
      </Field>

      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {initial ? "見積を更新" : "見積書を作成(下書き)"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}

/** 見積→請求書の転換フォーム(請求日付のみ入力。明細は見積からコピー) */
function ConvertForm({
  quote,
  onDone,
}: {
  quote: Quote;
  onDone: (invoiceNumber: string | undefined) => void;
}) {
  const { businessId } = useApp();
  const [issueDate, setIssueDate] = useState(todayDateString());
  // 支払期日の初期値は発行日+30日(変更可)
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const invoice = await callApi(() =>
        convertQuoteAction(businessId ?? "", quote.id, {
          issueDate,
          dueDate,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      onDone(invoice.invoiceNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "転換に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500">
        見積 {quote.quoteNumber ?? quote.id} の明細を請求書(下書き)へ
        コピーします。請求書の発行日・支払期日を指定してください。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="請求書の発行日">
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
        <Button type="submit" loading={busy}>
          請求書を作成
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

export function QuotesScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Quote | null>(null);
  const [convertTarget, setConvertTarget] = useState<string | null>(null);
  const [printQuote, setPrintQuote] = useState<Quote | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const { data, initialLoading, error, reload } = useApiData(async () => {
    const [rows, customers, projects] = await Promise.all([
      callApi(() => listQuoteRows(businessId ?? "")),
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

  const runTransition = async (
    quoteId: string,
    action: () => Promise<unknown>,
  ) => {
    setBusyIds((s) => new Set(s).add(quoteId));
    setActionError(undefined);
    try {
      await action();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "操作に失敗しました");
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(quoteId);
        return n;
      });
    }
  };

  // 帳票プレビュー表示中は一覧を丸ごと差し替え、ツールバーのみ no-print にする
  if (printQuote) {
    const customer = data?.customers.find(
      (c) => c.id === printQuote.customerId,
    );
    const project = printQuote.projectId
      ? data?.projects.find((p) => p.id === printQuote.projectId)
      : undefined;
    return (
      <div className="mx-auto max-w-4xl">
        <div className="no-print mb-4 flex items-center gap-2">
          <Button onClick={() => window.print()}>印刷 / PDFで保存</Button>
          <Button variant="secondary" onClick={() => setPrintQuote(null)}>
            一覧に戻る
          </Button>
          <p className="text-xs text-zinc-400">
            印刷ダイアログで「PDFとして保存」を選ぶとPDF化できます
          </p>
        </div>
        <QuoteSheet
          quote={printQuote}
          customerName={customer?.name ?? "-"}
          customerAddress={customer?.address}
          projectName={project?.name}
          issuerName={business?.issuerName || business?.name}
          issuerAddress={business?.issuerAddress}
          registrationNumber={business?.invoiceRegistrationNumber}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="見積"
        description="見積書の作成・送付・受注から請求書への転換を行います"
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditTarget(null);
                setShowForm((v) => !v);
              }}
            >
              {showForm && !editTarget ? "閉じる" : "見積書を作成"}
            </Button>
          ) : undefined
        }
      />

      {showForm && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">
            {editTarget ? "見積の編集" : "見積書の作成"}
          </h2>
          <QuoteForm
            customers={data?.customers ?? []}
            projects={data?.projects ?? []}
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

      {notice && (
        <Alert tone="info" className="mb-4">
          {notice}{" "}
          <Link
            href="/invoices"
            className="text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
          >
            請求・入金へ
          </Link>
        </Alert>
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
          title="見積書がまだありません"
          description={
            canEdit
              ? data?.customers.length
                ? "「見積書を作成」から下書きを作成してください"
                : "先に顧客一覧で顧客を登録してください"
              : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>見積番号</th>
                <th>顧客 / 案件</th>
                <th>発行日 / 有効期限</th>
                <th className="text-right">見積額</th>
                <th>状態</th>
                {canEdit && <th>操作</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const q = row.quote;
                return (
                  <Fragment key={q.id}>
                    <tr>
                      <td className="whitespace-nowrap font-medium">
                        {q.quoteNumber ?? q.id}
                        <div>
                          <button
                            type="button"
                            className="text-xs font-normal text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                            onClick={() => {
                              setConvertTarget(null);
                              setPrintQuote(q);
                            }}
                          >
                            印刷プレビュー
                          </button>
                        </div>
                      </td>
                      <td>
                        {customerName.get(q.customerId) ?? "-"}
                        {q.projectId && (
                          <span className="text-zinc-400">
                            {" "}
                            / {projectName.get(q.projectId) ?? ""}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {q.issueDate}
                        <span className="text-zinc-400"> → </span>
                        {q.validUntil}
                      </td>
                      <td className="text-right">
                        <Amount value={q.totalAmount} />
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge kind="quote" status={q.status} />
                          {q.status === "converted" &&
                            row.convertedInvoiceNumber && (
                              <span className="text-xs text-zinc-400">
                                {row.convertedInvoiceNumber}
                              </span>
                            )}
                        </div>
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap">
                          <div className="flex gap-2">
                            {q.status === "draft" && (
                              <>
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    setEditTarget(q);
                                    setShowForm(true);
                                  }}
                                >
                                  編集
                                </Button>
                                <Button
                                  onClick={() =>
                                    void runTransition(q.id, () =>
                                      callApi(() =>
                                        markQuoteSentAction(
                                          businessId ?? "",
                                          q.id,
                                        ),
                                      ),
                                    )
                                  }
                                  loading={busyIds.has(q.id)}
                                >
                                  送付済みにする
                                </Button>
                              </>
                            )}
                            {q.status === "sent" && (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  void runTransition(q.id, () =>
                                    callApi(() =>
                                      markQuoteAcceptedAction(
                                        businessId ?? "",
                                        q.id,
                                      ),
                                    ),
                                  )
                                }
                                loading={busyIds.has(q.id)}
                              >
                                受注にする
                              </Button>
                            )}
                            {(q.status === "sent" ||
                              q.status === "accepted") && (
                              <Button
                                onClick={() =>
                                  setConvertTarget(
                                    convertTarget === q.id ? null : q.id,
                                  )
                                }
                              >
                                請求書に変換
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {canEdit && convertTarget === q.id && (
                      <tr>
                        <td
                          colSpan={6}
                          className="bg-zinc-50/70 dark:bg-zinc-800/30"
                        >
                          <ConvertForm
                            quote={q}
                            onDone={(invoiceNumber) => {
                              setConvertTarget(null);
                              setNotice(
                                `請求書 ${invoiceNumber ?? ""} を下書きとして作成しました`,
                              );
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
