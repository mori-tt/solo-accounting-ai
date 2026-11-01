"use client";

import type { Transaction } from "@/lib/accounting/types";
import type {
  AccountSuggestionPayload,
  AISuggestionDTO,
  DuplicateDetectionPayload,
  MonthlyExplanationPayload,
  ReceiptExtractionPayload,
  SuggestionKind,
  SuggestionStatus,
  TransactionDescriptionPayload,
} from "@/lib/ai/types";
import { accountLabel } from "@/lib/accounts";
import { formatDateTime, formatYen } from "@/lib/format";
import { Alert, Badge, Button } from "./ui";

/**
 * aiSuggestionsコレクションの提案ドキュメント表示カード。
 * docs/AI_POLICY.md / ADR-0005: 提案値(payload)は確定データと分離して
 * 表示し、採用は必ずユーザー操作を経る(採用=提案値を確定値へコピーする
 * 別操作。採用しても取引は自動確定されない)。
 */

const KIND_LABELS: Record<SuggestionKind, string> = {
  receipt_extraction: "証憑抽出",
  account_suggestion: "勘定科目の提案",
  duplicate_detection: "重複チェック",
  transaction_description: "摘要の提案",
  monthly_explanation: "月次の説明",
};

const STATUS_BADGES: Record<
  SuggestionStatus,
  { tone: "gray" | "green" | "amber" | "indigo"; text: string }
> = {
  pending: { tone: "indigo", text: "確認待ち" },
  needs_review: { tone: "amber", text: "要確認" },
  accepted: { tone: "green", text: "採用済み" },
  rejected: { tone: "gray", text: "却下済み" },
};

/** 採用時に確定フィールドへ適用する値(ユーザー操作による反映)。 */
export interface AppliedSuggestionValue {
  account?: string;
  description?: string;
}

function confidencePct(confidence: number): number {
  return Math.round(confidence * 100);
}

/** payload のkind別レンダリング。確定値ではなく「AIの提案値」であることが視覚的に分かる配置 */
function SuggestionPayloadBody({
  suggestion,
  resolveTransaction,
}: {
  suggestion: AISuggestionDTO;
  resolveTransaction?: (transactionId: string) => Transaction | undefined;
}) {
  const payload = suggestion.payload;
  if (!payload) return null;

  switch (suggestion.kind) {
    case "receipt_extraction": {
      const p = payload as ReceiptExtractionPayload;
      return (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <div className="contents">
            <dt className="text-zinc-500">金額</dt>
            <dd className="font-medium">
              {p.amount !== null ? formatYen(p.amount) : "読み取れませんでした"}
            </dd>
          </div>
          <div className="contents">
            <dt className="text-zinc-500">日付</dt>
            <dd className="font-medium">{p.date ?? "読み取れませんでした"}</dd>
          </div>
          <div className="contents">
            <dt className="text-zinc-500">取引先</dt>
            <dd className="font-medium">{p.vendor ?? "不明"}</dd>
          </div>
        </dl>
      );
    }
    case "account_suggestion": {
      const p = payload as AccountSuggestionPayload;
      return (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {p.candidates.map((c, i) => (
            <li key={`${c.account}-${i}`}>
              <span className="font-medium">{accountLabel(c.account)}</span>
              <span className="ml-2 text-xs text-zinc-500">
                信頼度 {confidencePct(c.confidence)}%
              </span>
              {c.reason && (
                <span className="block text-xs text-zinc-400">{c.reason}</span>
              )}
            </li>
          ))}
        </ul>
      );
    }
    case "duplicate_detection": {
      const p = payload as DuplicateDetectionPayload;
      if (p.candidates.length === 0) {
        return (
          <p className="mt-2 text-sm">重複候補は見つかりませんでした</p>
        );
      }
      return (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {p.candidates.map((c) => {
            const t = resolveTransaction?.(c.transactionId);
            return (
              <li key={c.transactionId}>
                <span className="font-medium">
                  {t
                    ? `${t.date} / ${accountLabel(t.account)} / ${formatYen(t.amount)}`
                    : `取引 ${c.transactionId}`}
                </span>
                <span className="ml-2 text-xs text-zinc-500">
                  類似度 {confidencePct(c.score)}%
                </span>
                {c.reason && (
                  <span className="block text-xs text-zinc-400">{c.reason}</span>
                )}
              </li>
            );
          })}
        </ul>
      );
    }
    case "transaction_description": {
      const p = payload as TransactionDescriptionPayload;
      return <p className="mt-2 text-sm font-medium">{p.description}</p>;
    }
    case "monthly_explanation": {
      const p = payload as MonthlyExplanationPayload;
      return (
        <div className="mt-2 text-sm">
          <p>{p.explanation}</p>
          {p.highlights.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-zinc-500">
              {p.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }
  }
}

/** 採用ボタン。適用可能なkind(科目・摘要)は onApply 経由で確定フィールドへ反映する */
function DecideActions({
  suggestion,
  busy,
  onApply,
  onDecide,
}: {
  suggestion: AISuggestionDTO;
  busy: boolean;
  onApply?: (value: AppliedSuggestionValue) => void;
  onDecide?: (decision: "accepted" | "rejected") => void;
}) {
  const payload = suggestion.payload;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {suggestion.kind === "account_suggestion" && payload && onApply
        ? (payload as AccountSuggestionPayload).candidates.map((c, i) => (
            <Button
              key={`${c.account}-${i}`}
              onClick={() => onApply({ account: c.account })}
              disabled={busy}
            >
              「{accountLabel(c.account)}」を採用
            </Button>
          ))
        : suggestion.kind === "transaction_description" && payload && onApply
          ? (
            <Button
              onClick={() =>
                onApply({
                  description: (payload as TransactionDescriptionPayload)
                    .description,
                })
              }
              disabled={busy}
            >
              この摘要を採用
            </Button>
          )
          : payload && onDecide && (
              <Button onClick={() => onDecide("accepted")} disabled={busy}>
                確認済みにする
              </Button>
            )}
      {onDecide && (
        <Button
          variant="secondary"
          onClick={() => onDecide("rejected")}
          disabled={busy}
        >
          却下する
        </Button>
      )}
    </div>
  );
}

export function AISuggestionCard({
  suggestion,
  busy = false,
  canDecide = false,
  resolveTransaction,
  onApply,
  onDecide,
}: {
  suggestion: AISuggestionDTO;
  busy?: boolean;
  /** 採否ボタンを出すか(editor権限・対象データが変更可能な場合のみtrue) */
  canDecide?: boolean;
  /** duplicate_detection候補の表示を既存取引の内容で解決する */
  resolveTransaction?: (transactionId: string) => Transaction | undefined;
  /** 提案値を確定フィールドへ適用して採用する操作(科目・摘要の提案のみ) */
  onApply?: (value: AppliedSuggestionValue) => void;
  /** 採用(確認)/却下の決定操作 */
  onDecide?: (decision: "accepted" | "rejected") => void;
}) {
  const status = STATUS_BADGES[suggestion.status];
  const decidable =
    suggestion.status === "pending" || suggestion.status === "needs_review";

  return (
    <div className="rounded-md border border-dashed border-indigo-300 bg-indigo-50/60 p-3 dark:border-indigo-800 dark:bg-indigo-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="indigo">AI提案</Badge>
        <Badge tone="gray">{KIND_LABELS[suggestion.kind]}</Badge>
        <Badge tone={status.tone}>{status.text}</Badge>
        <span className="text-xs text-zinc-500">
          信頼度 {confidencePct(suggestion.confidence)}%
        </span>
        <span className="text-xs text-zinc-400">
          {formatDateTime(suggestion.createdAt)}
        </span>
      </div>

      <SuggestionPayloadBody
        suggestion={suggestion}
        resolveTransaction={resolveTransaction}
      />

      {suggestion.reason && (
        <p className="mt-2 text-xs text-zinc-500">根拠: {suggestion.reason}</p>
      )}

      {suggestion.status === "needs_review" && (
        <Alert tone="warning" className="mt-2">
          {suggestion.lastError
            ? "提案の生成に失敗しました。再度依頼するか、却下してください。"
            : "一部の項目を判定できませんでした。内容をよく確認してください。"}
        </Alert>
      )}

      {suggestion.status === "rejected" && suggestion.rejectReason && (
        <p className="mt-2 text-xs text-zinc-500">
          却下理由: {suggestion.rejectReason}
        </p>
      )}

      {canDecide && decidable && (onApply || onDecide) && (
        <DecideActions
          suggestion={suggestion}
          busy={busy}
          onApply={onApply}
          onDecide={onDecide}
        />
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
        AI提案はあくまで候補です。採用はあなたの確認操作を経て反映され、
        取引は自動確定されません。
      </p>
    </div>
  );
}
