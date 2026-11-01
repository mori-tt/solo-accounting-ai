import type {
  AccountSuggestionPayload,
  AISuggestion,
  TransactionDescriptionPayload,
} from "./types";

/**
 * 提案payloadからTransaction確定フィールドへのコピー値を組み立てる。
 * ADR-0005: 「提案を読み→ユーザーが確定値へ反映」の反映側にあたり、
 * 提案のaccept(状態解決)とは別のユーザー操作として実行する。
 * コピー対象はkindごとに決まったフィールドのみ(確定値の他項目は触れない)。
 */
export interface TransactionSuggestionPatch {
  account?: string;
  description?: string;
}

/**
 * Transactionへ反映可能な提案値を返す。
 * 反映できる値を持たないkind(duplicate_detection等)や
 * payload欠落時はnullを返す。
 */
export function transactionPatchFromSuggestion(
  suggestion: Pick<AISuggestion, "kind" | "payload">,
): TransactionSuggestionPatch | null {
  const payload = suggestion.payload;
  if (!payload) return null;
  switch (suggestion.kind) {
    case "account_suggestion": {
      // kindとpayloadの対応はnormalizeAIResponseが保証する
      const { candidates } = payload as AccountSuggestionPayload;
      if (candidates.length === 0) return null;
      // 最も信頼度の高い候補を採用値とする
      const best = [...candidates].sort(
        (a, b) => b.confidence - a.confidence,
      )[0];
      return { account: best.account };
    }
    case "transaction_description": {
      const { description } = payload as TransactionDescriptionPayload;
      return { description };
    }
    default:
      return null;
  }
}
