"use client";

import { useMemo, useState } from "react";
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
import { ACCOUNT_OPTIONS, accountLabel } from "@/lib/accounts";
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
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { AiSuggestionCard } from "@/components/ai-suggestion-card";
import { TransactionForm } from "./transaction-form";

const TYPE_LABELS: Record<string, string> = {
  income: "収入",
  expense: "支出",
  transfer: "振替",
};

function TransactionRow({
  transaction: t,
  suggestions,
  existingTransactions,
  canEdit,
  onChanged,
}: {
  transaction: Transaction;
  /** この取引を対象とするAI提案(新しい順) */
  suggestions: AISuggestionJSON[];
  /** 重複チェック等の照合対象とする同月の取引一覧 */
  existingTransactions: Transaction[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { businessId } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const mutable = t.status !== "locked";

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
        <td className="whitespace-nowrap">{t.date}</td>
        <td>{TYPE_LABELS[t.type] ?? t.type}</td>
        <td>{accountLabel(t.account)}</td>
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
          <td colSpan={6} className="bg-zinc-50/70 dark:bg-zinc-800/30">
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
                              accountCandidates: ACCOUNT_OPTIONS.map(
                                (a) => a.code,
                              ),
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
        message={`${t.date} / ${accountLabel(t.account)} / ${formatYen(t.amount)} を削除します。この操作は取り消せません。`}
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

export function TransactionsScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formBusy, setFormBusy] = useState(false);

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

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="取引一覧"
        description="取引はまず下書きとして登録し、内容を確認してから確定します"
        actions={
          canEdit ? (
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm ? "閉じる" : "取引を登録"}
            </Button>
          ) : undefined
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <MonthNav monthKey={monthKey} onChange={setMonthKey} />
        <Select
          className="w-32"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
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
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="状態で絞り込み"
        >
          <option value="">すべての状態</option>
          <option value="draft">下書き</option>
          <option value="confirmed">確定</option>
          <option value="locked">締め済み</option>
        </Select>
      </div>

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
                  onChanged={reload}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
