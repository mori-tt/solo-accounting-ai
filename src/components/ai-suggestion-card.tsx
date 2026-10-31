"use client";

import type { AiSuggestion } from "@/lib/accounting/types";
import { accountLabel } from "@/lib/accounts";
import { formatYen } from "@/lib/format";
import { Alert, Badge, Button } from "./ui";

/**
 * AI提案の表示カード。
 * AI_POLICY.md: 提案値(aiSuggestion)と確定値(本体フィールド)を
 * 明確に区別して表示し、採用はユーザー操作のみで行う。
 */

const SUGGESTED_FIELD_LABELS: Record<string, string> = {
  account: "勘定科目",
  amount: "金額",
  date: "日付",
  counterparty: "取引先",
  description: "摘要",
  type: "種別",
};

const TYPE_LABELS: Record<string, string> = {
  income: "収入",
  expense: "支出",
  transfer: "振替",
};

function formatSuggestedValue(field: string, value: unknown): string {
  if (field === "amount" && typeof value === "number") return formatYen(value);
  if (field === "account" && typeof value === "string") return accountLabel(value);
  if (field === "type" && typeof value === "string")
    return TYPE_LABELS[value] ?? value;
  return String(value);
}

export function AiSuggestionCard({
  suggestion,
  pendingLabel = "取引",
  busy = false,
  onApprove,
  onReject,
}: {
  suggestion: AiSuggestion;
  /** 「提案された○○」の対象名 */
  pendingLabel?: string;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const entries = Object.entries(suggestion.suggested);
  const confidencePct = Math.round(suggestion.confidence * 100);
  const statusLabel =
    suggestion.status === "approved"
      ? { tone: "green" as const, text: "採用済み" }
      : suggestion.status === "rejected"
        ? { tone: "gray" as const, text: "却下済み" }
        : { tone: "indigo" as const, text: "確認待ち" };

  return (
    <div className="rounded-md border border-dashed border-indigo-300 bg-indigo-50/60 p-3 dark:border-indigo-800 dark:bg-indigo-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="indigo">AI提案</Badge>
        <Badge tone={statusLabel.tone}>{statusLabel.text}</Badge>
        <span className="text-xs text-zinc-500">
          信頼度 {confidencePct}%
        </span>
        {suggestion.needsReview && (
          <Badge tone="amber">要確認</Badge>
        )}
      </div>

      {entries.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {entries.map(([field, value]) => (
            <div key={field} className="contents">
              <dt className="text-zinc-500">
                {SUGGESTED_FIELD_LABELS[field] ?? field}
              </dt>
              <dd className="font-medium">
                {formatSuggestedValue(field, value)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {suggestion.rationale && (
        <p className="mt-2 text-xs text-zinc-500">根拠: {suggestion.rationale}</p>
      )}

      {suggestion.needsReview && suggestion.status === "pending" && (
        <Alert tone="warning" className="mt-2">
          信頼度が低い提案です。内容をよく確認してください。
        </Alert>
      )}

      {suggestion.status === "pending" && (onApprove || onReject) && (
        <div className="mt-3 flex gap-2">
          {onApprove && (
            <Button onClick={onApprove} loading={busy}>
              提案を採用する
            </Button>
          )}
          {onReject && (
            <Button variant="secondary" onClick={onReject} disabled={busy}>
              却下する
            </Button>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
        AI提案はあくまで候補です。採用しても{pendingLabel}は自動確定されません。
      </p>
    </div>
  );
}
