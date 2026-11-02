"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  confirmTransactionAction,
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from "@/lib/actions/transactions";
import type { Transaction } from "@/lib/accounting/types";
import {
  callApi,
  decideAiSuggestion,
  fetchAiSuggestions,
  runAiSuggestion,
} from "@/lib/api-client";
import { transactionPatchFromSuggestion } from "@/lib/ai/apply";
import {
  isUnresolvedSuggestion,
  type AISuggestionJSON,
} from "@/lib/ai/types";
import type { AccountOption } from "@/lib/accounts";
import { useAccounts } from "@/lib/hooks/use-accounts";
import {
  currentMonthKey,
  formatMonthKey,
  formatYen,
  monthKeyDateRange,
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
  LoadingBlock,
  MonthNav,
  PageHeader,
  Select,
  Spinner,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { AiSuggestionCard } from "@/components/ai-suggestion-card";
import { buildTransactionsCsv, CSV_UTF8_BOM } from "@/lib/csv";
import { TransactionCsvImport } from "./transaction-csv-import";
import { TransactionForm } from "./transaction-form";

const TYPE_LABELS: Record<string, string> = {
  income: "収入",
  expense: "支出",
  transfer: "振替",
};

/**
 * 一括操作の対象外理由。draftのみ選択可。
 * confirmedは確定データとして扱うため行ごとの操作に限定し、
 * lockedは締め済み期間のため一切変更できない。
 */
function selectBlockReason(t: Transaction): string | undefined {
  if (t.status === "confirmed") {
    return "確定済みの取引は一括操作できません(行の展開から個別に操作してください)";
  }
  if (t.status === "locked") {
    return "締め済み期間の取引は一括操作できません";
  }
  return undefined;
}

function TransactionRow({
  transaction: t,
  suggestions,
  existingTransactions,
  canEdit,
  selected,
  selectDisabled,
  onToggleSelect,
  onChanged,
}: {
  transaction: Transaction;
  /** この取引を対象とするAI提案(新しい順) */
  suggestions: AISuggestionJSON[];
  /** 重複チェック等の照合対象とする同月の取引一覧 */
  existingTransactions: Transaction[];
  canEdit: boolean;
  /** 一括操作の選択状態。選択列はcanEdit時のみ描画される */
  selected: boolean;
  /** 一括処理の実行中は選択変更をロックする */
  selectDisabled: boolean;
  onToggleSelect: () => void;
  onChanged: () => void;
}) {
  const { businessId } = useApp();
  const { label, activeCodes } = useAccounts();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const mutable = t.status !== "locked";
  const blockReason = selectBlockReason(t);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      setExpanded(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        onClick={() => setExpanded((v) => !v)}
      >
        {canEdit && (
          <td onClick={(e) => e.stopPropagation()}>
            {blockReason ? (
              <span title={blockReason} className="inline-flex cursor-not-allowed">
                <input type="checkbox" disabled aria-label={blockReason} />
              </span>
            ) : (
              <input
                type="checkbox"
                checked={selected}
                disabled={selectDisabled}
                onChange={onToggleSelect}
                aria-label="この取引を選択"
              />
            )}
          </td>
        )}
        <td className="whitespace-nowrap">{t.date}</td>
        <td>{TYPE_LABELS[t.type] ?? t.type}</td>
        <td>{label(t.account)}</td>
        <td className="max-w-40 truncate">
          {t.counterparty}
          {t.description && (
            <span className="text-zinc-400"> / {t.description}</span>
          )}
        </td>
        <td className="text-right">
          <Amount value={t.amount} />
        </td>
        <td className="whitespace-nowrap">
          <StatusBadge kind="transaction" status={t.status} />
          {suggestions.some(isUnresolvedSuggestion) && (
            <span className="ml-1">
              <Badge tone="indigo">AI提案</Badge>
            </span>
          )}
          {t.receiptIds.length > 0 && (
            <span className="ml-1">
              <Badge tone="gray">領収書{t.receiptIds.length}</Badge>
            </span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={canEdit ? 7 : 6}
            className="bg-zinc-50/70 dark:bg-zinc-800/30"
          >
            <div
              className="flex flex-col gap-3 py-2"
              onClick={(e) => e.stopPropagation()}
            >
              {suggestions.map((s) => (
                <AiSuggestionCard
                  key={s.id}
                  suggestion={s}
                  busy={busy}
                  acceptLabel={
                    transactionPatchFromSuggestion(s)
                      ? "提案を採用して反映"
                      : "提案を採用する"
                  }
                  onAccept={
                    canEdit
                      ? () =>
                          run(async () => {
                            await decideAiSuggestion(
                              businessId ?? "",
                              s.id,
                              "accepted",
                            );
                            // 採用の反映は別ステップ: 提案値をユーザー操作で
                            // 確定フィールドへコピーする(ADR-0005)
                            const patch = transactionPatchFromSuggestion(s);
                            if (patch && mutable) {
                              await callApi(() =>
                                updateTransaction(businessId ?? "", t.id, {
                                  type: t.type,
                                  date: t.date,
                                  amount: t.amount,
                                  account: patch.account ?? t.account,
                                  counterparty: t.counterparty || undefined,
                                  description:
                                    patch.description ??
                                    (t.description || undefined),
                                }),
                              );
                            }
                          })
                      : undefined
                  }
                  onReject={
                    canEdit
                      ? () =>
                          run(() =>
                            decideAiSuggestion(
                              businessId ?? "",
                              s.id,
                              "rejected",
                            ),
                          )
                      : undefined
                  }
                />
              ))}

              {editing ? (
                <TransactionForm
                  initial={t}
                  busy={busy}
                  submitLabel="変更を保存"
                  onSubmit={async (input) => {
                    await run(() =>
                      callApi(() =>
                        updateTransaction(businessId ?? "", t.id, input),
                      ),
                    );
                    setEditing(false);
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                canEdit &&
                mutable && (
                  <div className="flex flex-wrap gap-2">
                    {t.status === "draft" && (
                      <Button
                        onClick={() =>
                          run(() =>
                            callApi(() =>
                              confirmTransactionAction(businessId ?? "", t.id),
                            ),
                          )
                        }
                        loading={busy}
                      >
                        確定する
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() =>
                        run(() =>
                          runAiSuggestion(
                            businessId ?? "",
                            "account_suggestion",
                            { type: "transaction", id: t.id },
                            {
                              counterparty: t.counterparty,
                              description: t.description,
                              date: t.date,
                              amount: t.amount,
                              accountCandidates: activeCodes,
                            },
                          ),
                        )
                      }
                      disabled={busy}
                    >
                      科目をAI提案
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        run(() =>
                          runAiSuggestion(
                            businessId ?? "",
                            "transaction_description",
                            { type: "transaction", id: t.id },
                            {
                              counterparty: t.counterparty,
                              date: t.date,
                              type: t.type,
                              amount: t.amount,
                            },
                          ),
                        )
                      }
                      disabled={busy}
                    >
                      摘要をAI提案
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        run(() =>
                          runAiSuggestion(
                            businessId ?? "",
                            "duplicate_detection",
                            { type: "transaction", id: t.id },
                            {
                              transaction: {
                                id: t.id,
                                amount: t.amount,
                                date: t.date,
                              },
                              existingTransactions: existingTransactions.map(
                                (x) => ({
                                  id: x.id,
                                  amount: x.amount,
                                  date: x.date,
                                }),
                              ),
                            },
                          ),
                        )
                      }
                      disabled={busy}
                    >
                      重複チェック
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setEditing(true)}
                      disabled={busy}
                    >
                      編集
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setConfirmDelete(true)}
                      disabled={busy}
                    >
                      削除
                    </Button>
                  </div>
                )
              )}
              {error && <Alert tone="error">{error}</Alert>}
            </div>
          </td>
        </tr>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="取引の削除"
        message={`${t.date} / ${label(t.account)} / ${formatYen(t.amount)} を削除します。この操作は取り消せません。`}
        confirmLabel="削除する"
        loading={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void run(() =>
            callApi(() => deleteTransaction(businessId ?? "", t.id)),
          );
        }}
      />
    </>
  );
}

/** 一括処理の進捗表示用 */
interface BulkProgress {
  done: number;
  total: number;
}

/** 一括処理の結果表示用 */
interface BulkResult {
  label: string;
  ok: number;
  ng: number;
  /** 最初に発生した失敗のメッセージ(あれば) */
  error?: string;
}

/**
 * 選択中の下書き取引への一括操作バー。
 * 科目一括変更(種別が異なる行が混在する場合は全種別で使える科目のみ提示)と
 * 一括削除を実行する。処理中は件数の進捗を表示し操作をロックする。
 */
function BulkActionBar({
  count,
  account,
  accountOptions,
  accountLabel,
  onAccountChange,
  onApplyAccount,
  onRequestDelete,
  onClear,
  progress,
}: {
  count: number;
  account: string;
  /** 選択行の取引種別すべてに適用できる科目(共通部分) */
  accountOptions: AccountOption[];
  accountLabel: (code: string) => string;
  onAccountChange: (code: string) => void;
  onApplyAccount: () => void;
  onRequestDelete: () => void;
  onClear: () => void;
  progress: BulkProgress | null;
}) {
  const running = progress !== null;
  const accountApplicable = accountOptions.some((o) => o.code === account);
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium">{count}件選択中</span>
      <Select
        className="w-48"
        value={account}
        onChange={(e) => onAccountChange(e.target.value)}
        aria-label="一括変更する科目"
        disabled={running}
      >
        <option value="">科目を選択</option>
        {accountOptions.map((a) => (
          <option key={a.code} value={a.code}>
            {a.label}
          </option>
        ))}
        {account !== "" && !accountApplicable && (
          <option value={account}>{accountLabel(account)}</option>
        )}
      </Select>
      <Button
        variant="secondary"
        onClick={onApplyAccount}
        disabled={running || !accountApplicable}
      >
        科目を一括変更
      </Button>
      <Button variant="danger" onClick={onRequestDelete} disabled={running}>
        一括削除
      </Button>
      <Button variant="ghost" onClick={onClear} disabled={running}>
        選択解除
      </Button>
      {progress && (
        <span
          className="inline-flex items-center gap-2 text-sm text-zinc-500"
          role="status"
        >
          <Spinner className="h-4 w-4" />
          {progress.done}/{progress.total} 件を処理中…
        </span>
      )}
    </Card>
  );
}

export function TransactionsScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const { options, optionsFor, label } = useAccounts();
  const canEdit = business?.role !== "viewer";

  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [bulkAccount, setBulkAccount] = useState("");
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const range = useMemo(() => monthKeyDateRange(monthKey), [monthKey]);
  const { data, initialLoading, error, reload } = useApiData(async () => {
    const [transactions, suggestions] = await Promise.all([
      callApi(() =>
        listTransactions(businessId ?? "", {
          startDate: range.startDate,
          endDate: range.endDate,
        }),
      ),
      businessId
        ? fetchAiSuggestions(businessId, { targetType: "transaction" })
        : Promise.resolve([]),
    ]);
    return { transactions, suggestions };
  }, [businessId, range.startDate, range.endDate]);

  const suggestionsByTarget = useMemo(() => {
    const map = new Map<string, AISuggestionJSON[]>();
    for (const s of data?.suggestions ?? []) {
      const list = map.get(s.target.id) ?? [];
      list.push(s);
      map.set(s.target.id, list);
    }
    return map;
  }, [data?.suggestions]);

  const filtered = useMemo(
    () =>
      (data?.transactions ?? []).filter(
        (t) =>
          (typeFilter === "" || t.type === typeFilter) &&
          (statusFilter === "" || t.status === statusFilter),
      ),
    [data, typeFilter, statusFilter],
  );

  // 月・絞り込みを変えたら選択と結果をリセットし、
  // 非表示の行への誤操作を防ぐ(フィルタ系onChangeから呼ぶ)
  const resetBulk = () => {
    setSelectedIds(new Set());
    setBulkResult(null);
  };

  const selectableRows = useMemo(
    () => filtered.filter((t) => t.status === "draft"),
    [filtered],
  );
  // 表示中かつdraftの行のみを操作対象とする。
  // 確定済み/削除済みで残ったIDは自然に対象外になるため別途掃除しない
  const selectedRows = useMemo(
    () =>
      filtered.filter(
        (t) => selectedIds.has(t.id) && t.status === "draft",
      ),
    [filtered, selectedIds],
  );
  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every((t) => selectedIds.has(t.id));
  const someSelected = selectableRows.some((t) => selectedIds.has(t.id));

  // 科目一括変更の選択肢は、選択行の取引種別すべてに
  // 適用できる科目の共通部分(混在時は振替・その他系のみ)
  const bulkAccountOptions = useMemo(() => {
    if (selectedRows.length === 0) return [];
    let opts = optionsFor(selectedRows[0].type);
    for (const t of selectedRows.slice(1)) {
      const codes = new Set(optionsFor(t.type).map((o) => o.code));
      opts = opts.filter((o) => codes.has(o.code));
    }
    return opts;
  }, [selectedRows, optionsFor]);

  const toggleSelect = (t: Transaction) => {
    if (selectBlockReason(t)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(t.id)) {
        next.delete(t.id);
      } else {
        next.add(t.id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const t of selectableRows) next.delete(t.id);
      } else {
        for (const t of selectableRows) next.add(t.id);
      }
      return next;
    });
  };

  /**
   * 選択行へ1件ずつ順に実行する部分失敗モデル(CSV取込と同型)。
   * 失敗行のみ選択を残して再実行しやすくする。
   */
  const runBulk = async (
    actionLabel: string,
    fn: (t: Transaction) => Promise<unknown>,
  ) => {
    const targets = selectedRows;
    if (targets.length === 0) return;
    setBulkResult(null);
    setBulkProgress({ done: 0, total: targets.length });
    const failed = new Set<string>();
    let firstError: string | undefined;
    let done = 0;
    for (const t of targets) {
      try {
        await fn(t);
      } catch (e) {
        failed.add(t.id);
        firstError ??=
          e instanceof Error ? e.message : "処理に失敗しました";
      }
      done += 1;
      setBulkProgress({ done, total: targets.length });
    }
    setBulkProgress(null);
    setBulkResult({
      label: actionLabel,
      ok: targets.length - failed.size,
      ng: failed.size,
      ...(firstError ? { error: firstError } : {}),
    });
    setSelectedIds(failed);
    reload();
  };

  const runBulkDelete = () =>
    runBulk("一括削除", (t) =>
      callApi(() => deleteTransaction(businessId ?? "", t.id)),
    );

  const runBulkAccount = () => {
    // 選択構成の変化で適用不可になった科目は送らない
    if (!bulkAccountOptions.some((o) => o.code === bulkAccount)) return;
    const account = bulkAccount;
    return runBulk("科目の一括変更", (t) =>
      callApi(() =>
        updateTransaction(businessId ?? "", t.id, {
          type: t.type,
          date: t.date,
          amount: t.amount,
          account,
          counterparty: t.counterparty || undefined,
          description: t.description || undefined,
          // taxCategory/taxRate は省略=既存値を保持
        }),
      ),
    );
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="取引一覧"
        description="取引はまず下書きとして登録し、内容を確認してから確定します"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                // BOM付UTF-8でExcelでも文字化けせず開ける
                const blob = new Blob(
                  [
                    CSV_UTF8_BOM +
                      buildTransactionsCsv(
                        data?.transactions ?? [],
                        options,
                      ),
                  ],
                  { type: "text/csv;charset=utf-8" },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `transactions-${monthKey}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              disabled={data === undefined}
            >
              CSV出力
            </Button>
            {canEdit && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setShowImport((v) => !v)}
                >
                  {showImport ? "取込を閉じる" : "CSV取込"}
                </Button>
                <Link
                  href="/transactions/import"
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  明細CSVインポート
                </Link>
                <Button onClick={() => setShowForm((v) => !v)}>
                  {showForm ? "閉じる" : "取引を登録"}
                </Button>
              </>
            )}
          </>
        }
      />

      {showForm && (
        <Card className="mb-4">
          <h2 className="mb-3 text-sm font-semibold">取引の登録</h2>
          <TransactionForm
            busy={formBusy}
            submitLabel="下書きとして登録"
            onSubmit={async (input) => {
              setFormBusy(true);
              try {
                await callApi(() =>
                  createTransaction(businessId ?? "", {
                    ...input,
                    idempotencyKey: crypto.randomUUID(),
                  }),
                );
                setShowForm(false);
                reload();
              } finally {
                setFormBusy(false);
              }
            }}
            onCancel={() => setShowForm(false)}
          />
        </Card>
      )}

      {canEdit && showImport && (
        <TransactionCsvImport
          businessId={businessId ?? ""}
          onImported={reload}
          onClose={() => setShowImport(false)}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <MonthNav
          monthKey={monthKey}
          onChange={(v) => {
            setMonthKey(v);
            resetBulk();
          }}
        />
        <Select
          className="w-32"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            resetBulk();
          }}
          aria-label="種別で絞り込み"
        >
          <option value="">すべての種別</option>
          <option value="income">収入</option>
          <option value="expense">支出</option>
          <option value="transfer">振替</option>
        </Select>
        <Select
          className="w-36"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            resetBulk();
          }}
          aria-label="状態で絞り込み"
        >
          <option value="">すべての状態</option>
          <option value="draft">下書き</option>
          <option value="confirmed">確定</option>
          <option value="locked">締め済み</option>
        </Select>
      </div>

      {canEdit && selectedRows.length > 0 && (
        <BulkActionBar
          count={selectedRows.length}
          account={bulkAccount}
          accountOptions={bulkAccountOptions}
          accountLabel={label}
          onAccountChange={setBulkAccount}
          onApplyAccount={() => void runBulkAccount()}
          onRequestDelete={() => setConfirmBulkDelete(true)}
          onClear={() => setSelectedIds(new Set())}
          progress={bulkProgress}
        />
      )}

      {bulkResult && (
        <Alert
          tone={bulkResult.ng === 0 ? "info" : "warning"}
          className="mb-4 flex items-center justify-between gap-3"
        >
          <span>
            {bulkResult.label}: {bulkResult.ok}件成功
            {bulkResult.ng > 0 &&
              ` / ${bulkResult.ng}件失敗(失敗分は選択したままです)`}
            {bulkResult.error && ` — ${bulkResult.error}`}
          </span>
          <button
            type="button"
            className="shrink-0 text-xs underline"
            onClick={() => setBulkResult(null)}
          >
            閉じる
          </button>
        </Alert>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            data !== undefined && data.transactions.length > 0
              ? "条件に一致する取引がありません"
              : `${formatMonthKey(monthKey)}の取引はまだありません`
          }
          description={
            canEdit
              ? "「取引を登録」から下書きとして登録できます"
              : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                {canEdit && (
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label="すべての下書きを選択"
                      checked={allSelected}
                      disabled={
                        bulkProgress !== null || selectableRows.length === 0
                      }
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = someSelected && !allSelected;
                        }
                      }}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
                <th>日付</th>
                <th>種別</th>
                <th>科目</th>
                <th>取引先 / 摘要</th>
                <th className="text-right">金額</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <TransactionRow
                  key={t.id}
                  transaction={t}
                  suggestions={suggestionsByTarget.get(t.id) ?? []}
                  existingTransactions={data?.transactions ?? []}
                  canEdit={canEdit}
                  selected={selectedIds.has(t.id)}
                  selectDisabled={bulkProgress !== null}
                  onToggleSelect={() => toggleSelect(t)}
                  onChanged={reload}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title="取引の一括削除"
        message={`選択した ${selectedRows.length} 件の下書き取引を削除します。この操作は取り消せません。`}
        confirmLabel="削除する"
        loading={bulkProgress !== null}
        onCancel={() => setConfirmBulkDelete(false)}
        onConfirm={() => {
          setConfirmBulkDelete(false);
          void runBulkDelete();
        }}
      />
    </div>
  );
}
