"use client";

import type {
  AISuggestionJSON,
  SuggestionPayload,
} from "@/lib/ai/types";
import { isUnresolvedSuggestion } from "@/lib/ai/types";
import { accountLabel } from "@/lib/accounts";
import { formatYen } from "@/lib/format";
import { Alert, Badge, Button } from "./ui";

/**
 * AI提案の表示カード(aiSuggestionsコレクションの提案ドキュメント用)。
 * AI_POLICY.md / ADR-0005: 提案(payload)と確定値(本体フィールド)を
 * 明確に区別して表示し、承認・却下・確定値への反映はすべてユーザー操作。
 */

const KIND_LABELS: Record<AISuggestionJSON["kind"], string> = {
  receipt_extraction: "証憑抽出",
  account_suggestion: "勘定科目の提案",
  duplicate_detection: "重複の疑い",
  transaction_description: "摘要の提案",
  monthly_explanation: "月次の説明",
};

function PayloadFields({ suggestion }: { suggestion: AISuggestionJSON }) {
  const payload = suggestion.payload;
  if (!payload) {
    return (
      <p className="mt-2 text-sm text-zinc-500">
        提案値を生成できませんでした。再実行するか手入力してください。
      </p>
    );
  }
  switch (suggestion.kind) {
    case "receipt_extraction": {
      const p = payload as Extract<SuggestionPayload, { amount: unknown }>;
      const rows: [string, string][] = [
        ["金額", p.amount !== null ? formatYen(p.amount) : "読み取り不可"],
        ["日付", p.date ?? "読み取り不可"],
        ["取引先", p.vendor ?? "不明"],
      ];
      return (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      );
    }
    case "account_suggestion": {
      const { candidates } = payload as Extract<
        SuggestionPayload,
        { candidates: { account: string; confidence: number; reason: string }[] }
      >;
      return (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {candidates.map((c, i) => (
            <li key={`${c.account}-${i}`}>
              <span className="font-medium">{accountLabel(c.account)}</span>
              <span className="ml-2 text-xs text-zinc-500">
                {Math.round(c.confidence * 100)}%
              </span>
              {c.reason && (
                <span className="ml-2 text-xs text-zinc-400">{c.reason}</span>
              )}
            </li>
          ))}
        </ul>
      );
    }
    case "duplicate_detection": {
      const { candidates } = payload as Extract<
        SuggestionPayload,
        { candidates: { transactionId: string; score: number; reason: string }[] }
      >;
      if (candidates.length === 0) {
        return (
          <p className="mt-2 text-sm text-zinc-500">
            重複候補は見つかりませんでした
          </p>
        );
      }
      return (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {candidates.map((c) => (
            <li key={c.transactionId}>
              <span className="font-medium">取引 {c.transactionId}</span>
              <span className="ml-2 text-xs text-zinc-500">
                類似度 {Math.round(c.score * 100)}%
              </span>
              {c.reason && (
                <span className="ml-2 text-xs text-zinc-400">{c.reason}</span>
              )}
            </li>
          ))}
        </ul>
      );
    }
    case "transaction_description": {
      const { description } = payload as Extract<
        SuggestionPayload,
        { description: string }
      >;
      return <p className="mt-2 text-sm font-medium">{description}</p>;
    }
    case "monthly_explanation": {
      const p = payload as Extract<
        SuggestionPayload,
        { explanation: string; highlights: string[] }
      >;
      return (
        <div className="mt-2">
          <p className="text-sm">{p.explanation}</p>
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

export function AiSuggestionCard({
  suggestion,
  pendingLabel = "取引",
  busy = false,
  acceptLabel = "提案を採用する",
  onAccept,
  onReject,
}: {
  suggestion: AISuggestionJSON;
  /** 「自動確定されません」の注記に使う対象名 */
  pendingLabel?: string;
  busy?: boolean;
  /** 採用ボタンの文言(確定値への反映を伴う場合は変更する) */
  acceptLabel?: string;
  onAccept?: () => void;
  onReject?: () => void;
}) {
  const confidencePct = Math.round(suggestion.confidence * 100);
  const unresolved = isUnresolvedSuggestion(suggestion);
  const statusLabel =
    suggestion.status === "accepted"
      ? { tone: "green" as const, text: "採用済み" }
      : suggestion.status === "rejected"
        ? { tone: "gray" as const, text: "却下済み" }
        : suggestion.status === "needs_review"
          ? { tone: "amber" as const, text: "要確認" }
          : { tone: "indigo" as const, text: "確認待ち" };

  return (
    <div className="rounded-md border border-dashed border-indigo-300 bg-indigo-50/60 p-3 dark:border-indigo-800 dark:bg-indigo-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="indigo">AI提案</Badge>
        <span className="text-xs text-zinc-500">
          {KIND_LABELS[suggestion.kind]}
        </span>
        <Badge tone={statusLabel.tone}>{statusLabel.text}</Badge>
        <span className="text-xs text-zinc-500">信頼度 {confidencePct}%</span>
      </div>

      <PayloadFields suggestion={suggestion} />

      {suggestion.reason && (
        <p className="mt-2 text-xs text-zinc-500">根拠: {suggestion.reason}</p>
      )}

      {suggestion.status === "needs_review" && (
        <Alert tone="warning" className="mt-2">
          内容をよく確認してください
          {suggestion.issues.length > 0 &&
            `(${suggestion.issues.join(", ")})`}
        </Alert>
      )}

      {unresolved && (onAccept || onReject) && (
        <div className="mt-3 flex gap-2">
          {onAccept && (
            <Button onClick={onAccept} loading={busy}>
              {acceptLabel}
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
