"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createInventoryItem,
  deleteInventoryItemAction,
  listInventoryYearData,
  saveInventoryCountAction,
  updateInventoryItemAction,
  type InventoryYearData,
} from "@/lib/actions/inventory";
import { callApi } from "@/lib/api-client";
import { inventoryLineAmount } from "@/lib/accounting/domain/inventory";
import { fiscalYearOf } from "@/lib/accounting/domain/fiscal";
import type { InventoryCountLineInput } from "@/lib/accounting/services/inventory";
import type { InventoryItem } from "@/lib/accounting/types";
import {
  inventoryCountSchema,
  inventoryItemSchema,
  parseForm,
  type InventoryItemInput,
} from "@/lib/validation/schemas";
import { formatDateTime, formatYen, todayDateString } from "@/lib/format";
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
  TextInput,
  tableClass,
} from "@/components/ui";
import { YearNav } from "../reports/year-nav";

function ItemForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: InventoryItem;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (input: InventoryItemInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [standardUnitPrice, setStandardUnitPrice] = useState(
    initial ? String(initial.standardUnitPrice) : "",
  );
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (standardUnitPrice.trim() === "") {
      setError("標準単価を入力してください");
      return;
    }
    const input = {
      name,
      unit,
      standardUnitPrice: Number(standardUnitPrice),
    };
    const parsed = parseForm(inventoryItemSchema, input);
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
        <Field label="品目名">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 商品A"
            required
          />
        </Field>
        <Field label="単位">
          <TextInput
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="例: 個・本・kg"
            required
          />
        </Field>
        <Field label="標準単価(円)" hint="棚卸カウントの評価単価の初期値">
          <NumberInput
            value={standardUnitPrice}
            min={0}
            step={1}
            placeholder="例: 1000"
            onChange={(e) => setStandardUnitPrice(e.target.value)}
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

/** 年度別の期末棚卸カウント入力。数量×評価単価で期末棚卸高を自動計算する。 */
function CountEditor({
  fiscalYear,
  data,
  canEdit,
  busy,
  onSave,
}: {
  fiscalYear: number;
  data: InventoryYearData;
  canEdit: boolean;
  busy: boolean;
  onSave: (lines: InventoryCountLineInput[]) => Promise<void>;
}) {
  const { items, count, closed } = data;
  // 削除済み品目の明細(品目マスタに無い行)は編集対象外。
  // 保存時に除外されることを警告で明示する。
  const orphans = (count?.lines ?? []).filter(
    (line) => !items.some((item) => item.id === line.itemId),
  );
  const orphanAmount = orphans.reduce(
    (sum, line) => sum + inventoryLineAmount(line.quantity, line.unitPrice),
    0,
  );

  const [edits, setEdits] = useState<
    Record<string, { quantity: string; unitPrice: string }>
  >(() => {
    const byItem = new Map(
      (count?.lines ?? []).map((line) => [line.itemId, line]),
    );
    const map: Record<string, { quantity: string; unitPrice: string }> = {};
    for (const item of items) {
      const line = byItem.get(item.id);
      map[item.id] = {
        quantity: line ? String(line.quantity) : "",
        // 空欄 = 標準単価を使う(placeholder に標準単価を表示)
        unitPrice: line ? String(line.unitPrice) : "",
      };
    }
    return map;
  });
  const [formError, setFormError] = useState<string>();

  const setLine = (itemId: string, patch: { quantity?: string; unitPrice?: string }) => {
    setEdits((prev) => ({
      ...prev,
      [itemId]: {
        quantity: prev[itemId]?.quantity ?? "",
        unitPrice: prev[itemId]?.unitPrice ?? "",
        ...patch,
      },
    }));
  };

  const rows = items.map((item) => {
    const e = edits[item.id] ?? { quantity: "", unitPrice: "" };
    const quantity = e.quantity === "" ? 0 : Number(e.quantity);
    const unitPrice =
      e.unitPrice === "" ? item.standardUnitPrice : Number(e.unitPrice);
    const amount =
      Number.isFinite(quantity) && Number.isFinite(unitPrice)
        ? inventoryLineAmount(quantity, unitPrice)
        : 0;
    return { item, e, quantity, unitPrice, amount };
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  const save = async () => {
    const lines: InventoryCountLineInput[] = [];
    for (const item of items) {
      const e = edits[item.id] ?? { quantity: "", unitPrice: "" };
      const q = e.quantity.trim();
      if (q === "" || Number(q) === 0) continue;
      const line: InventoryCountLineInput = {
        itemId: item.id,
        quantity: Number(q),
      };
      const p = e.unitPrice.trim();
      if (p !== "") line.unitPrice = Number(p);
      lines.push(line);
    }
    const parsed = parseForm(inventoryCountSchema, { fiscalYear, lines });
    if (!parsed.success) {
      setFormError(formIssuesMessage(parsed.issues));
      return;
    }
    setFormError(undefined);
    try {
      await onSave(parsed.data.lines);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "保存に失敗しました",
      );
    }
  };

  const readOnly = closed || !canEdit;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <span>
          期末棚卸高 = 各品目の 数量 × 評価単価 の合計。
          <Link
            href="/reports/filing"
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            決算書(収支内訳書)
          </Link>
          の期末商品棚卸高に自動反映されます
        </span>
        {count ? (
          <Badge tone="indigo">入力済み</Badge>
        ) : (
          <Badge tone="gray">未入力</Badge>
        )}
      </div>

      {closed && (
        <Alert tone="info" className="mb-3">
          {fiscalYear}年度は締め済みのため棚卸カウントを変更できません
        </Alert>
      )}
      {orphans.length > 0 && (
        <Alert tone="warning" className="mb-3">
          削除済み品目の明細が{orphans.length}件あります(合計{" "}
          <Amount value={orphanAmount} />
          分)。保存するとこれらの明細は除外されます
        </Alert>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          棚卸対象の品目がありません。先に下の「棚卸品目」へ品目を登録してください。
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>品目名</th>
                  <th>単位</th>
                  <th>標準単価</th>
                  <th className="w-28">数量</th>
                  <th className="w-32">評価単価(円)</th>
                  <th className="text-right">金額</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, e, amount }) => (
                  <tr key={item.id}>
                    <td className="font-medium">{item.name}</td>
                    <td>{item.unit}</td>
                    <td>
                      <Amount value={item.standardUnitPrice} />
                    </td>
                    <td>
                      {readOnly ? (
                        e.quantity === "" ? (
                          "-"
                        ) : (
                          e.quantity
                        )
                      ) : (
                        <NumberInput
                          value={e.quantity}
                          min={0}
                          step="any"
                          placeholder="0"
                          aria-label={`${item.name}の数量`}
                          onChange={(ev) =>
                            setLine(item.id, { quantity: ev.target.value })
                          }
                        />
                      )}
                    </td>
                    <td>
                      {readOnly ? (
                        e.unitPrice === "" ? (
                          <Amount value={item.standardUnitPrice} />
                        ) : (
                          e.unitPrice
                        )
                      ) : (
                        <NumberInput
                          value={e.unitPrice}
                          min={0}
                          step={1}
                          placeholder={String(item.standardUnitPrice)}
                          aria-label={`${item.name}の評価単価`}
                          onChange={(ev) =>
                            setLine(item.id, { unitPrice: ev.target.value })
                          }
                        />
                      )}
                    </td>
                    <td className="text-right">
                      <Amount value={amount} />
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={5}>期末棚卸高 計</td>
                  <td className="text-right">
                    <Amount value={total} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {formError && (
            <Alert tone="error" className="mt-3">
              {formError}
            </Alert>
          )}

          {canEdit && !closed && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button onClick={save} loading={busy}>
                棚卸カウントを保存
              </Button>
              {count && (
                <span className="text-xs text-zinc-400">
                  最終保存: {formatDateTime(count.updatedAt)} / 保存済み棚卸高:{" "}
                  {formatYen(data.totalAmount)}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function InventoryScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";
  const isOwner = business?.role === "owner";
  const startMonth = business?.fiscalYearStartMonth ?? 1;

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const fiscalYear =
    selectedYear ?? fiscalYearOf(todayDateString(), startMonth);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => listInventoryYearData(businessId ?? "", fiscalYear)),
    [businessId, fiscalYear],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="棚卸・在庫管理"
        description="棚卸品目の登録と年度別の期末棚卸カウントを管理します。期末棚卸高は決算書へ連携されます"
        actions={
          canEdit ? (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm((v) => !v);
              }}
            >
              {showForm && !editing ? "閉じる" : "品目を登録"}
            </Button>
          ) : undefined
        }
      />

      {notice && (
        <Alert tone="info" className="mb-4">
          {notice}
        </Alert>
      )}

      {(showForm || editing) && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">
            {editing ? "品目の編集" : "品目の登録"}
          </h2>
          <ItemForm
            initial={editing ?? undefined}
            busy={busy}
            submitLabel={editing ? "変更を保存" : "登録する"}
            onSubmit={async (input) => {
              setBusy(true);
              try {
                if (editing) {
                  await callApi(() =>
                    updateInventoryItemAction(
                      businessId ?? "",
                      editing.id,
                      input,
                    ),
                  );
                } else {
                  await callApi(() =>
                    createInventoryItem(businessId ?? "", {
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
      ) : initialLoading || !data ? (
        <LoadingBlock />
      ) : (
        <>
          <Card className="mb-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">期末棚卸カウント</h2>
              <YearNav
                fiscalYear={fiscalYear}
                startMonth={startMonth}
                onChange={setSelectedYear}
              />
            </div>
            <CountEditor
              key={fiscalYear}
              fiscalYear={fiscalYear}
              data={data}
              canEdit={canEdit}
              busy={busy}
              onSave={async (lines) => {
                setBusy(true);
                setNotice(undefined);
                try {
                  const res = await callApi(() =>
                    saveInventoryCountAction(businessId ?? "", {
                      fiscalYear,
                      lines,
                    }),
                  );
                  setNotice(
                    `${fiscalYear}年度の期末棚卸高を保存しました(${formatYen(res.totalAmount)})`,
                  );
                  reload();
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Card>

          <Card className="overflow-x-auto p-0">
            <div className="px-4 pt-3">
              <h2 className="text-sm font-semibold">棚卸品目</h2>
            </div>
            {data.items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="棚卸品目がまだありません"
                  description={
                    canEdit ? "「品目を登録」から追加してください" : undefined
                  }
                />
              </div>
            ) : (
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th>品目名</th>
                    <th>単位</th>
                    <th>標準単価</th>
                    {canEdit && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      <td className="font-medium">{item.name}</td>
                      <td>{item.unit}</td>
                      <td>
                        <Amount value={item.standardUnitPrice} />
                      </td>
                      {canEdit && (
                        <td>
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setEditing(item);
                                setShowForm(false);
                              }}
                            >
                              編集
                            </Button>
                            {isOwner && (
                              <Button
                                variant="secondary"
                                onClick={() => setDeleting(item)}
                              >
                                削除
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="品目の削除"
        message={`「${deleting?.name ?? ""}」を削除します。保存済みの棚卸カウントの明細(品目名・単位のスナップショット)は残ります。`}
        confirmLabel="削除する"
        loading={busy}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await callApi(() =>
              deleteInventoryItemAction(businessId ?? "", deleting.id),
            );
            setDeleting(null);
            reload();
          } finally {
            setBusy(false);
          }
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
