"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createRecurringTemplate,
  generateRecurringForMonth,
  listRecurringTemplates,
  setRecurringTemplateActiveAction,
  updateRecurringTemplateAction,
} from "@/lib/actions/recurring";
import { callApi } from "@/lib/api-client";
import type {
  RecurringTemplate,
  TransactionType,
} from "@/lib/accounting/types";
import { accountLabel, accountOptionsFor } from "@/lib/accounts";
import {
  parseForm,
  recurringTemplateSchema,
  type RecurringTemplateInput,
} from "@/lib/validation/schemas";
import { currentMonthKey, formatMonthKey } from "@/lib/format";
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

const TYPE_OPTIONS = [
  { value: "expense", label: "支出" },
  { value: "income", label: "収入" },
  { value: "transfer", label: "振替" },
] as const;

const TYPE_LABELS: Record<TransactionType, string> = {
  expense: "支出",
  income: "収入",
  transfer: "振替",
};

function TemplateForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: RecurringTemplate;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (input: RecurringTemplateInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<TransactionType>(initial?.type ?? "expense");
  const [account, setAccount] = useState(initial?.account ?? "");
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : "",
  );
  const [dayOfMonth, setDayOfMonth] = useState(
    initial ? String(initial.dayOfMonth) : "",
  );
  const [counterparty, setCounterparty] = useState(
    initial?.counterparty ?? "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string>();

  const accounts = accountOptionsFor(type);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      name,
      type,
      account,
      counterparty: counterparty || undefined,
      description: description || undefined,
      amount: Number(amount),
      dayOfMonth: Number(dayOfMonth),
    };
    const parsed = parseForm(recurringTemplateSchema, input);
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
            placeholder="例: 事務所家賃"
            required
          />
        </Field>
        <Field label="種別">
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as TransactionType);
              setAccount("");
            }}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="金額(円)">
          <NumberInput
            value={amount}
            min={1}
            step={1}
            placeholder="例: 100000"
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="毎月の日付" hint="月末を超える場合は末日に調整">
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
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="勘定科目">
          <Select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            required
          >
            <option value="">選択してください</option>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.label}
              </option>
            ))}
            {account && !accounts.some((a) => a.code === account) && (
              <option value={account}>{accountLabel(account)}</option>
            )}
          </Select>
        </Field>
        <Field label="取引先">
          <TextInput
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="例: 〇〇不動産"
          />
        </Field>
        <Field label="摘要">
          <TextInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例: 毎月の家賃"
          />
        </Field>
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

export function RecurringScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecurringTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [noticeError, setNoticeError] = useState<string>();

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => listRecurringTemplates(businessId ?? "")),
    [businessId],
  );

  const monthKey = currentMonthKey();

  const runGenerate = async () => {
    setGenerating(true);
    setNotice(undefined);
    setNoticeError(undefined);
    try {
      const res = await callApi(() =>
        generateRecurringForMonth(businessId ?? "", { monthKey }),
      );
      setNotice(
        res.created > 0
          ? `${formatMonthKey(monthKey)}分の取引を${res.created}件生成しました(下書き)`
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

  const toggleActive = async (t: RecurringTemplate) => {
    setNoticeError(undefined);
    try {
      await callApi(() =>
        setRecurringTemplateActiveAction(businessId ?? "", t.id, !t.active),
      );
      reload();
    } catch (err) {
      setNoticeError(
        err instanceof Error ? err.message : "更新に失敗しました",
      );
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="定期取引"
        description="毎月繰り返し発生する取引のテンプレートを管理します"
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

      {notice && <Alert tone="info" className="mb-4">{notice}</Alert>}
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
            initial={editing ?? undefined}
            busy={busy}
            submitLabel={editing ? "変更を保存" : "登録する"}
            onSubmit={async (input) => {
              setBusy(true);
              try {
                if (editing) {
                  await callApi(() =>
                    updateRecurringTemplateAction(
                      businessId ?? "",
                      editing.id,
                      { ...input, active: editing.active },
                    ),
                  );
                } else {
                  await callApi(() =>
                    createRecurringTemplate(businessId ?? "", {
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
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="定期取引テンプレートがまだありません"
          description={
            canEdit
              ? "「テンプレートを登録」から追加してください"
              : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>名前</th>
                <th>種別</th>
                <th>勘定科目</th>
                <th>金額</th>
                <th>毎月</th>
                <th>状態</th>
                <th>最終生成月</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}</td>
                  <td>{TYPE_LABELS[t.type]}</td>
                  <td>{accountLabel(t.account)}</td>
                  <td>
                    <Amount value={t.amount} />
                  </td>
                  <td>{t.dayOfMonth}日</td>
                  <td>
                    <Badge tone={t.active ? "green" : "gray"}>
                      {t.active ? "有効" : "無効"}
                    </Badge>
                  </td>
                  <td>
                    {t.lastGeneratedMonth
                      ? formatMonthKey(t.lastGeneratedMonth)
                      : "-"}
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
        title="今月分の取引を生成"
        message={`${formatMonthKey(monthKey)}分の取引を、まだ生成されていない有効なテンプレートから一括作成します(下書きとして登録)。`}
        confirmLabel="生成する"
        danger={false}
        loading={generating}
        onConfirm={runGenerate}
        onCancel={() => setConfirmGenerate(false)}
      />
    </div>
  );
}
