"use client";

import { useState } from "react";
import {
  AISuggestionCard,
  type AppliedSuggestionValue,
} from "@/components/ai-suggestions";
import { useApp } from "@/components/auth-provider";
import { Alert, Button, Spinner } from "@/components/ui";
import { updateTransaction } from "@/lib/actions/transactions";
import type { Transaction } from "@/lib/accounting/types";
import { decideAISuggestion, runAISuggestion } from "@/lib/ai/client";
import type { AISuggestionDTO, SuggestionKind } from "@/lib/ai/types";
import { callApi } from "@/lib/api-client";
import { accountOptionsFor } from "@/lib/accounts";
import { useAISuggestions } from "@/lib/hooks/use-ai-suggestions";

/**
 * 取引1件に対するAI提案パネル(展開行内に表示)。
 * - 生成: POST /api/ai/suggestions(fetch)。receipt_extractionはOCR基盤待ちのため対象外
 * - 採用: 提案値を updateTransaction で確定フィールドへコピーし、
 *   提案を accepted に解決する(2ステップ・ADR-0005)。取引のstatusは変わらず
 *   draft/confirmed のまま(確定は confirmTransaction のみが行う)
 * - 却下: 提案を rejected に解決するのみ(確定データは触らない)
 */

const RUN_BUTTONS: { kind: SuggestionKind; label: string }[] = [
  { kind: "account_suggestion", label: "科目を提案" },
  { kind: "transaction_description", label: "摘要を提案" },
  { kind: "duplicate_detection", label: "重複チェック" },
];

/** kindごとにAIへ渡す入力を組み立てる(サーバー側でさらに最小化される) */
function buildInput(
  kind: SuggestionKind,
  t: Transaction,
  existing: Transaction[],
): Record<string, unknown> {
  switch (kind) {
    case "account_suggestion":
      return {
        counterparty: t.counterparty,
        description: t.description,
        date: t.date,
        amount: t.amount,
        accountCandidates: accountOptionsFor(t.type).map((a) => a.code),
      };
    case "transaction_description":
      return {
        counterparty: t.counterparty,
        date: t.date,
        type: t.type,
        amount: t.amount,
      };
    case "duplicate_detection":
      // 一覧に読み込み済みの取引(同月)を照合対象にする
      return {
        transaction: { id: t.id, amount: t.amount, date: t.date },
        existingTransactions: existing.map((x) => ({
          id: x.id,
          amount: x.amount,
          date: x.date,
        })),
      };
    default:
      return {};
  }
}

export function TransactionAIPanel({
  transaction: t,
  existingTransactions,
  canEdit,
  onChanged,
}: {
  transaction: Transaction;
  /** 重複チェックの照合対象・候補表示の解決に使う取引一覧 */
  existingTransactions: Transaction[];
  /** editor以上かつ対象が変更可能(locked以外)のときtrue */
  canEdit: boolean;
  /** 取引の確定フィールドが変わったときに呼ばれる */
  onChanged: () => void;
}) {
  const { businessId } = useApp();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const {
    data: suggestions,
    initialLoading,
    error,
    reload,
  } = useAISuggestions(businessId, { type: "transaction", id: t.id });

  const run = async (fn: () => Promise<unknown>, changed = false) => {
    if (!businessId) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await fn();
      reload();
      if (changed) onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const generate = (kind: SuggestionKind) =>
    run(() =>
      runAISuggestion({
        businessId: businessId ?? "",
        kind,
        target: { type: "transaction", id: t.id },
        input: buildInput(kind, t, existingTransactions),
      }),
    );

  const decide = (s: AISuggestionDTO, decision: "accepted" | "rejected") =>
    run(() =>
      decideAISuggestion({
        businessId: businessId ?? "",
        suggestionId: s.id,
        decision,
      }),
    );

  const apply = (s: AISuggestionDTO, value: AppliedSuggestionValue) =>
    run(async () => {
      // 先に確定フィールドへ反映し、成功したら提案を採用済みにする。
      // (反映が失敗した場合は提案を未解決のまま残す)
      await callApi(() =>
        updateTransaction(businessId ?? "", t.id, {
          type: t.type,
          date: t.date,
          amount: t.amount,
          account: value.account ?? t.account,
          counterparty: t.counterparty,
          description: value.description ?? t.description,
        }),
      );
      await decideAISuggestion({
        businessId: businessId ?? "",
        suggestionId: s.id,
        decision: "accepted",
      });
    }, true);

  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-zinc-500">AIアシスタント</p>
        {canEdit &&
          RUN_BUTTONS.map(({ kind, label }) => (
            <Button
              key={kind}
              variant="secondary"
              disabled={busy}
              onClick={() => void generate(kind)}
            >
              {label}
            </Button>
          ))}
      </div>

      {actionError && (
        <Alert tone="error" className="mt-2">
          {actionError}
        </Alert>
      )}

      {initialLoading ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
          <Spinner className="h-4 w-4" />
          <span>読み込み中...</span>
        </div>
      ) : error ? (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      ) : suggestions && suggestions.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {suggestions.map((s) => (
            <AISuggestionCard
              key={s.id}
              suggestion={s}
              busy={busy}
              canDecide={canEdit}
              resolveTransaction={(id) =>
                existingTransactions.find((x) => x.id === id)
              }
              onApply={canEdit ? (value) => void apply(s, value) : undefined}
              onDecide={canEdit ? (d) => void decide(s, d) : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-400">
          この取引へのAI提案はまだありません
        </p>
      )}
    </div>
  );
}
