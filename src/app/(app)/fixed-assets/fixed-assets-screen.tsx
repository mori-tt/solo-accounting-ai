"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  bookDepreciationForCurrentYear,
  createFixedAsset,
  disposeFixedAssetAction,
  listFixedAssetRows,
  updateFixedAssetAction,
  type FixedAssetRow,
} from "@/lib/actions/fixedAssets";
import { callApi } from "@/lib/api-client";
import type {
  DepreciationMethod,
  FixedAsset,
} from "@/lib/accounting/types";
import { fiscalPeriodOf } from "@/lib/accounting/dates";
import {
  parseForm,
  disposeFixedAssetSchema,
  fixedAssetSchema,
  type FixedAssetInput,
} from "@/lib/validation/schemas";
import { formatDateJP, todayDateString } from "@/lib/format";
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

const METHOD_LABELS: Record<DepreciationMethod, string> = {
  straightLine: "定額法",
  decliningBalance: "定率法",
};

function AssetForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: FixedAsset;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (input: FixedAssetInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [acquiredDate, setAcquiredDate] = useState(
    initial?.acquiredDate ?? "",
  );
  const [acquisitionCost, setAcquisitionCost] = useState(
    initial ? String(initial.acquisitionCost) : "",
  );
  const [usefulLifeYears, setUsefulLifeYears] = useState(
    initial ? String(initial.usefulLifeYears) : "",
  );
  const [method, setMethod] = useState<DepreciationMethod>(
    initial?.method ?? "straightLine",
  );
  const [businessRatio, setBusinessRatio] = useState(
    initial ? String(initial.businessRatio) : "100",
  );
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      name,
      acquiredDate,
      acquisitionCost: Number(acquisitionCost),
      usefulLifeYears: Number(usefulLifeYears),
      method,
      businessRatio: Number(businessRatio),
    };
    const parsed = parseForm(fixedAssetSchema, input);
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="資産名">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 複合機"
            required
          />
        </Field>
        <Field label="取得日">
          <TextInput
            type="date"
            value={acquiredDate}
            onChange={(e) => setAcquiredDate(e.target.value)}
            required
          />
        </Field>
        <Field label="取得価額(円)">
          <NumberInput
            value={acquisitionCost}
            min={1}
            step={1}
            placeholder="例: 300000"
            onChange={(e) => setAcquisitionCost(e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="耐用年数(年)">
          <NumberInput
            value={usefulLifeYears}
            min={1}
            max={100}
            step={1}
            placeholder="例: 5"
            onChange={(e) => setUsefulLifeYears(e.target.value)}
            required
          />
        </Field>
        <Field label="償却方法">
          <Select
            value={method}
            onChange={(e) => setMethod(e.target.value as DepreciationMethod)}
          >
            <option value="straightLine">定額法</option>
            <option value="decliningBalance">定率法(200%)</option>
          </Select>
        </Field>
        <Field label="事業割合(%)" hint="家事按分がある場合は0〜100">
          <NumberInput
            value={businessRatio}
            min={0}
            max={100}
            step={1}
            onChange={(e) => setBusinessRatio(e.target.value)}
            required
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

function DisposeForm({
  asset,
  busy,
  onSubmit,
  onCancel,
}: {
  asset: FixedAsset;
  busy?: boolean;
  onSubmit: (disposedDate: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [disposedDate, setDisposedDate] = useState(todayDateString());
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(disposeFixedAssetSchema, { disposedDate });
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setError(undefined);
    try {
      await onSubmit(parsed.data.disposedDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "除却に失敗しました");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        「{asset.name}」を除却します。除却月までの月割り償却は計上対象のままです。
      </p>
      <div className="max-w-56">
        <Field label="除却日">
          <TextInput
            type="date"
            value={disposedDate}
            min={asset.acquiredDate}
            onChange={(e) => setDisposedDate(e.target.value)}
            required
          />
        </Field>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" loading={busy}>
          除却する
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}

export function FixedAssetsScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmBook, setConfirmBook] = useState(false);
  const [booking, setBooking] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [noticeError, setNoticeError] = useState<string>();

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => listFixedAssetRows(businessId ?? "")),
    [businessId],
  );

  const fiscalYear = fiscalPeriodOf(
    todayDateString(),
    business?.fiscalYearStartMonth ?? 1,
  ).fiscalYear;

  const runBook = async () => {
    setBooking(true);
    setNotice(undefined);
    setNoticeError(undefined);
    try {
      const res = await callApi(() =>
        bookDepreciationForCurrentYear(businessId ?? ""),
      );
      setNotice(
        res.created > 0
          ? `${res.fiscalYear}年度分の償却費を${res.created}件の取引として生成しました(下書き)`
          : `${res.fiscalYear}年度に計上対象の資産はありません`,
      );
      reload();
    } catch (err) {
      setNoticeError(
        err instanceof Error ? err.message : "計上に失敗しました",
      );
    } finally {
      setBooking(false);
      setConfirmBook(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="固定資産・減価償却"
        description="固定資産台帳と減価償却費の計上を管理します。帳簿価額・累計償却は当年末時点の見込み額です"
        actions={
          canEdit ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmBook(true)}
              >
                {fiscalYear}年度分を経費計上
              </Button>
              <Button
                onClick={() => {
                  setEditing(null);
                  setDisposing(null);
                  setShowForm((v) => !v);
                }}
              >
                {showForm && !editing ? "閉じる" : "資産を登録"}
              </Button>
            </>
          ) : undefined
        }
      />

      {notice && (
        <Alert tone="info" className="mb-4">
          {notice}
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
            {editing ? "資産の編集" : "資産の登録"}
          </h2>
          <AssetForm
            initial={editing ?? undefined}
            busy={busy}
            submitLabel={editing ? "変更を保存" : "登録する"}
            onSubmit={async (input) => {
              setBusy(true);
              try {
                if (editing) {
                  await callApi(() =>
                    updateFixedAssetAction(
                      businessId ?? "",
                      editing.id,
                      input,
                    ),
                  );
                } else {
                  await callApi(() =>
                    createFixedAsset(businessId ?? "", {
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

      {disposing && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">資産の除却</h2>
          <DisposeForm
            asset={disposing}
            busy={busy}
            onSubmit={async (disposedDate) => {
              setBusy(true);
              try {
                await callApi(() =>
                  disposeFixedAssetAction(businessId ?? "", disposing.id, {
                    disposedDate,
                  }),
                );
                setDisposing(null);
                reload();
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => setDisposing(null)}
          />
        </Card>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="固定資産がまだありません"
          description={
            canEdit ? "「資産を登録」から追加してください" : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>資産名</th>
                <th>取得日</th>
                <th>取得価額</th>
                <th>償却方法</th>
                <th>耐用年数</th>
                <th>事業割合</th>
                <th>{fiscalYear}年度償却費</th>
                <th>累計償却</th>
                <th>帳簿価額</th>
                <th>状態</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <AssetRow
                  key={row.asset.id}
                  row={row}
                  canEdit={canEdit}
                  onEdit={() => {
                    setEditing(row.asset);
                    setDisposing(null);
                    setShowForm(false);
                  }}
                  onDispose={() => {
                    setDisposing(row.asset);
                    setEditing(null);
                    setShowForm(false);
                  }}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ConfirmDialog
        open={confirmBook}
        title="当年分の償却費を経費計上"
        message={`${fiscalYear}年度分の償却費を、未計上の資産ごとに取引(支出・減価償却費)として生成します(下書きとして登録・日付は年度末日)。`}
        confirmLabel="計上する"
        danger={false}
        loading={booking}
        onConfirm={runBook}
        onCancel={() => setConfirmBook(false)}
      />
    </div>
  );
}

function AssetRow({
  row,
  canEdit,
  onEdit,
  onDispose,
}: {
  row: FixedAssetRow;
  canEdit: boolean;
  onEdit: () => void;
  onDispose: () => void;
}) {
  const { asset } = row;
  const disposed = asset.status === "disposed";
  return (
    <tr key={asset.id}>
      <td className="font-medium">{asset.name}</td>
      <td>{formatDateJP(asset.acquiredDate)}</td>
      <td>
        <Amount value={asset.acquisitionCost} />
      </td>
      <td>{METHOD_LABELS[asset.method]}</td>
      <td>{asset.usefulLifeYears}年</td>
      <td>{asset.businessRatio}%</td>
      <td>
        <Amount value={row.annualExpense} />
        {asset.businessRatio < 100 && row.annualExpense > 0 && (
          <div className="text-xs text-zinc-400">
            計上 <Amount value={row.bookableExpense} />
          </div>
        )}
      </td>
      <td>
        <Amount value={row.accumulated} />
      </td>
      <td>
        <Amount value={row.bookValue} />
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          <Badge tone={disposed ? "gray" : "green"}>
            {disposed ? "除却済" : "保有中"}
          </Badge>
          {row.booked && <Badge tone="indigo">計上済</Badge>}
        </div>
      </td>
      {canEdit && (
        <td>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onEdit}>
              編集
            </Button>
            {!disposed && (
              <Button variant="secondary" onClick={onDispose}>
                除却
              </Button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
