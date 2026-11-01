"use client";

import { useState } from "react";
import { AISuggestionCard } from "@/components/ai-suggestions";
import { useApp } from "@/components/auth-provider";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { getMonthlyReport } from "@/lib/actions/reports";
import type { MonthlySummary } from "@/lib/accounting/types";
import {
  callApi,
  decideAiSuggestion,
  runAiSuggestion,
} from "@/lib/api-client";
import { shiftMonthKey } from "@/lib/format";
import { useAISuggestions } from "@/lib/hooks/use-ai-suggestions";

/**
 * 月次集計へのAI説明(monthly_explanation)。
 * AI_POLICY.md「月次説明は表示のみ(確定データに影響しない)」に従い、
 * 生成・確認・却下のみを行い、集計値には書き戻さない。
 * 対象は保存済みの monthlySummaries ドキュメント(未保存の月は生成不可)。
 */
export function MonthlyAIExplanation({
  monthKey,
  persisted,
  canEdit,
}: {
  monthKey: string;
  /** monthlySummaries に保存済みの集計。未保存なら undefined */
  persisted?: MonthlySummary;
  canEdit: boolean;
}) {
  const { businessId } = useApp();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const {
    data: suggestions,
    initialLoading,
    error,
    reload,
  } = useAISuggestions(
    businessId,
    { type: "monthlySummary", id: monthKey },
    "monthly_explanation",
  );

  const run = async (fn: () => Promise<unknown>) => {
    if (!businessId) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const generate = () =>
    run(async () => {
      const prev = await callApi(() =>
        getMonthlyReport(businessId ?? "", shiftMonthKey(monthKey, -1)),
      );
      await runAiSuggestion(
        businessId ?? "",
        "monthly_explanation",
        { type: "monthlySummary", id: monthKey },
        {
          summary: persisted,
          previousSummary: prev.persisted ?? prev.current,
        },
      );
    });

  return (
    <Card className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">AIによる月次の説明</h2>
        {canEdit &&
          (persisted ? (
            <Button
              variant="secondary"
              onClick={() => void generate()}
              loading={busy}
            >
              AIに説明を生成
            </Button>
          ) : (
            <p className="text-xs text-zinc-400">
              先に「集計を保存して更新」で集計を保存すると生成できます
            </p>
          ))}
      </div>

      {actionError && (
        <Alert tone="error" className="mb-2">
          {actionError}
        </Alert>
      )}

      {initialLoading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Spinner className="h-4 w-4" />
          <span>読み込み中...</span>
        </div>
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : suggestions && suggestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          {suggestions.map((s) => (
            <AISuggestionCard
              key={s.id}
              suggestion={s}
              busy={busy}
              canDecide={canEdit}
              onDecide={
                canEdit
                  ? (decision) =>
                      void run(() =>
                        decideAiSuggestion(businessId ?? "", s.id, decision),
                      )
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          この月のAI説明はまだ生成されていません
        </p>
      )}
    </Card>
  );
}
