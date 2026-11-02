"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createRecurringInvoiceTemplate,
  generateRecurringInvoicesForMonth,
  listRecurringInvoiceTemplates,
  setRecurringInvoiceTemplateActiveAction,
  updateRecurringInvoiceTemplateAction,
} from "@/lib/actions/recurring-invoices";
import { listCustomers, listProjects } from "@/lib/actions/sales";
import { callApi } from "@/lib/api-client";
import { computeInvoiceTotals } from "@/lib/accounting/invoice-tax";
import type { ConsumptionTaxRate } from "@/lib/accounting/domain/tax";
import type { RecurringInvoiceTemplate } from "@/lib/accounting/types";
import {
  parseForm,
  recurringInvoiceTemplateSchema,
  type RecurringInvoiceTemplateInput,
} from "@/lib/validation/schemas";
import {
  currentMonthKey,
  formatMonthKey,
  todayDateString,
} from "@/lib/format";
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
  formIssuesMessage,
  LoadingBlock,
  NumberInput,
  PageHeader,
  Select,
  TextInput,
  tableClass,
} from "@/components/ui";

const INTERVAL_OPTIONS = [
  { value: 1, label: "毎月" },
  { value: 2, label: "2か月ごと" },
  { value: 3, label: "3か月ごと" },
  { value: 6, label: "半年ごと" },
  { value: 12, label: "毎年" },
] as const;

function intervalLabel(months: number): string {
  return (
    INTERVAL_OPTIONS.find((o) => o.value === months)?.label ??
    `${months}か月ごと`
  );
}

interface ItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: ConsumptionTaxRate;
}

function TemplateForm({
  customers,
  projects,
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  customers: { id: string; name: string }[];
  projects: { id: string; name: string; customerId: string }[];
  initial?: RecurringInvoiceTemplate;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (input: RecurringInvoiceTemplateInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [intervalMonths, setIntervalMonths] = useState(
    String(initial?.intervalMonths ?? 1),
  );
  const [dayOfMonth, setDayOfMonth] = useState(
    initial ? String(initial.dayOfMonth) : "",
  );
  const [startDate, setStartDate] = useState(
    initial?.startDate ?? todayDateString(),
  );
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [maxOccurrences, setMaxOccurrences] = useState(
    initial?.maxOccurrences ? String(initial.maxOccurrences) : "",
  );
  const [dueDays, setDueDays] = useState(
    initial ? String(initial.dueDays) : "30",
  );
  const [items, setItems] = useState<ItemDraft[]>(
    initial?.items.map((i) => ({
      description: i.description,
      quantity: String(i.quantity),
      unitPrice: String(i.unitPrice),
      taxRate: i.taxRate ?? "standard",
    })) ?? [{ description: "", quantity: "1", unitPrice: "", taxRate: "standard" }],
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
      name,
      customerId,
      projectId: projectId || undefined,
      items: items.map((i) => ({
        description: i.description,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        taxRate: i.taxRate,
      })),
      intervalMonths: Number(intervalMonths),
      dayOfMonth: Number(dayOfMonth),
      startDate,
      endDate: endDate || undefined,
      maxOccurrences: maxOccurrences ? Number(maxOccurrences) : undefined,
      dueDays: Number(dueDays),
    };
    const parsed = parseForm(recurringInvoiceTemplateSchema, input);
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setError(undefined);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="テンプレート名">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 顧問料"
            required
          />
        </Field>
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
        <Field label="生成間隔">
          <Select
            value={intervalMonths}
            onChange={(e) => setIntervalMonths(e.target.value)}
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label="毎月の発行日" hint="月末を超える場合は末日に調整">
          <NumberInput
            value={dayOfMonth}
            min={1}
            max={31}
            step={1}
            placeholder="例: 25"
            onChange={(e) => setDayOfMonth(e.target.value)}
            required
          />
        </Field>
        <Field label="開始日">
          <TextInput
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </Field>
        <Field label="終了日(任意)">
          <TextInput
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
        <Field label="生成回数(任意)" hint="終了条件を回数で指定する場合">
          <NumberInput
            value={maxOccurrences}
            min={1}
            max={999}
            step={1}
            placeholder="例: 12"
            onChange={(e) => setMaxOccurrences(e.target.value)}
          />
        </Field>
        <Field label="支払期日" hint="発行日からの日数">
          <NumberInput
            value={dueDays}
            min={0}
            max={366}
            step={1}
            onChange={(e) => setDueDays(e.target.value)}
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
              placeholder="例: 顧問料(月額)"
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
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}

export function RecurringInvoicesScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecurringInvoiceTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [noticeError, setNoticeError] = useState<string>();

  const { data, initialLoading, error, reload } = useApiData(async () => {
    const [templates, customers, projects] = await Promise.all([
      callApi(() => listRecurringInvoiceTemplates(businessId ?? "")),
      callApi(() => listCustomers(businessId ?? "")),
      callApi(() => listProjects(businessId ?? "")),
    ]);
    return { templates, customers, projects };
  }, [businessId]);

  const customerName = useMemo(
    () =>
      new Map((data?.customers ?? []).map((c) => [c.id, c.name] as const)),
    [data],
  );

  const monthKey = currentMonthKey();

  const runGenerate = async () => {
    setGenerating(true);
    setNotice(undefined);
    setNoticeError(undefined);
    try {
      const res = await callApi(() =>
        generateRecurringInvoicesForMonth(businessId ?? "", { monthKey }),
      );
      setNotice(
        res.created > 0
          ? `${formatMonthKey(monthKey)}分の請求書を${res.created}件生成しました(下書き)`
          : `${formatMonthKey(monthKey)}に生成対象のテンプレートはありません`,
      );
      reload();
    } catch (err) {
      setNoticeError(
        err instanceof Error ? err.message : "生成に失敗しました",
      );
    } finally {
      setGenerating(false);
      setConfirmGenerate(false);
    }
  };

  const toggleActive = async (t: RecurringInvoiceTemplate) => {
    setNoticeError(undefined);
    try {
      await callApi(() =>
        setRecurringInvoiceTemplateActiveAction(
          businessId ?? "",
          t.id,
          !t.active,
        ),
      );
      reload();
    } catch (err) {
      setNoticeError(
        err instanceof Error ? err.message : "更新に失敗しました",
      );
    }
  };

  const scheduleLabel = (t: RecurringInvoiceTemplate): string => {
    const end =
      t.endDate !== undefined
        ? `〜${t.endDate}`
        : t.maxOccurrences !== undefined
          ? `〜${t.maxOccurrences}回`
          : "〜終了条件なし";
    return `${t.startDate}${end}`;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="定期請求書"
        description="毎月定額など繰り返し発行する請求書のテンプレートを管理します。生成された請求書は下書きとして登録され、請求・入金画面で確認・発行できます"
        actions={
          canEdit ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmGenerate(true)}
              >
                {formatMonthKey(monthKey)}分を生成
              </Button>
              <Button
                onClick={() => {
                  setEditing(null);
                  setShowForm((v) => !v);
                }}
              >
                {showForm && !editing ? "閉じる" : "テンプレートを登録"}
              </Button>
            </>
          ) : undefined
        }
      />

      {notice && (
        <Alert tone="info" className="mb-4">
          {notice}
          <Link
            href="/invoices"
            className="ml-2 text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
          >
            請求・入金画面で確認
          </Link>
        </Alert>
      )}
      {noticeError && (
        <Alert tone="error" className="mb-4">
          {noticeError}
        </Alert>
      )}

      {(showForm || editing) && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">
            {editing ? "テンプレートの編集" : "テンプレートの登録"}
          </h2>
          <TemplateForm
            customers={data?.customers ?? []}
            projects={data?.projects ?? []}
            initial={editing ?? undefined}
            busy={busy}
            submitLabel={editing ? "変更を保存" : "登録する"}
            onSubmit={async (input) => {
              setBusy(true);
              try {
                if (editing) {
                  await callApi(() =>
                    updateRecurringInvoiceTemplateAction(
                      businessId ?? "",
                      editing.id,
                      { ...input, active: editing.active },
                    ),
                  );
                } else {
                  await callApi(() =>
                    createRecurringInvoiceTemplate(businessId ?? "", {
                      ...input,
                      idempotencyKey: crypto.randomUUID(),
                    }),
                  );
                }
                setEditing(null);
                setShowForm(false);
                reload();
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => {
              setEditing(null);
              setShowForm(false);
            }}
          />
        </Card>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data || data.templates.length === 0 ? (
        <EmptyState
          title="定期請求書テンプレートがまだありません"
          description={
            canEdit
              ? data?.customers.length
                ? "「テンプレートを登録」から追加してください"
                : "先に顧客一覧で顧客を登録してください"
              : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>名前</th>
                <th>顧客</th>
                <th>間隔</th>
                <th>発行日</th>
                <th>期間・終了条件</th>
                <th className="text-right">請求額</th>
                <th>状態</th>
                <th>最終生成月 / 生成数</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {data.templates.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}</td>
                  <td>{customerName.get(t.customerId) ?? "-"}</td>
                  <td className="whitespace-nowrap">
                    {intervalLabel(t.intervalMonths)}
                  </td>
                  <td className="whitespace-nowrap">{t.dayOfMonth}日</td>
                  <td className="whitespace-nowrap text-xs">
                    {scheduleLabel(t)}
                  </td>
                  <td className="text-right">
                    <Amount
                      value={computeInvoiceTotals(t.items).totalAmount}
                    />
                  </td>
                  <td>
                    <Badge tone={t.active ? "green" : "gray"}>
                      {t.active ? "有効" : "無効"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap">
                    {t.lastGeneratedMonth
                      ? formatMonthKey(t.lastGeneratedMonth)
                      : "-"}
                    <span className="text-zinc-400">
                      {" / "}
                      {t.generatedCount}件
                    </span>
                  </td>
                  {canEdit && (
                    <td>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditing(t);
                            setShowForm(false);
                          }}
                        >
                          編集
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => toggleActive(t)}
                        >
                          {t.active ? "無効化" : "有効化"}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ConfirmDialog
        open={confirmGenerate}
        title="今月分の請求書を生成"
        message={`${formatMonthKey(monthKey)}分の請求書を、まだ生成されていない有効なテンプレートから一括作成します(下書きとして登録)。`}
        confirmLabel="生成する"
        danger={false}
        loading={generating}
        onConfirm={runGenerate}
        onCancel={() => setConfirmGenerate(false)}
      />
    </div>
  );
}
