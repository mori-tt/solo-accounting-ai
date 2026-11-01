// AI支援機能の型定義。
// 方針: docs/AI_POLICY.md。AI出力は確定データと分離し、
// 必ず理由(reason)と信頼度(confidence)を持つ。

export const SUGGESTION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "needs_review",
] as const;

/** AI提案の状態。needs_reviewは判断不能・処理失敗を含む */
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_KINDS = [
  "receipt_extraction",
  "account_suggestion",
  "duplicate_detection",
  "transaction_description",
  "monthly_explanation",
] as const;

export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export type SuggestionTargetType =
  | "receipt"
  | "transaction"
  | "monthlySummary";

/** kind が対象にする target.type。配線側でこの対応を検証する */
export const KIND_TARGET_TYPE: Record<SuggestionKind, SuggestionTargetType> = {
  receipt_extraction: "receipt",
  account_suggestion: "transaction",
  duplicate_detection: "transaction",
  transaction_description: "transaction",
  monthly_explanation: "monthlySummary",
};

export interface SuggestionTarget {
  type: SuggestionTargetType;
  /** 対象ドキュメントID。monthlySummaryの場合は "yyyyMM" */
  id: string;
}

/** 証憑抽出の提案値。読み取れなかったフィールドはnull */
export interface ReceiptExtractionPayload {
  amount: number | null;
  date: string | null;
  vendor: string | null;
}

export interface AccountCandidate {
  account: string;
  confidence: number;
  reason: string;
}

export interface AccountSuggestionPayload {
  candidates: AccountCandidate[];
}

export interface DuplicateCandidate {
  transactionId: string;
  /** 重複らしさのスコア 0..1 */
  score: number;
  reason: string;
}

export interface DuplicateDetectionPayload {
  candidates: DuplicateCandidate[];
}

export interface TransactionDescriptionPayload {
  description: string;
}

export interface MonthlyExplanationPayload {
  explanation: string;
  highlights: string[];
}

export type SuggestionPayload =
  | ReceiptExtractionPayload
  | AccountSuggestionPayload
  | DuplicateDetectionPayload
  | TransactionDescriptionPayload
  | MonthlyExplanationPayload;

export type SuggestionErrorCode =
  | "timeout"
  | "provider_error"
  | "invalid_response";

/**
 * AI処理の失敗情報。個人情報・証憑内容を含めないこと
 * (プロバイダのエラーメッセージは要約のみ記録する)。
 */
export interface SuggestionError {
  code: SuggestionErrorCode;
  message: string;
}

/**
 * businesses/{businessId}/aiSuggestions/{suggestionId} に保存する提案レコード。
 * 確定値(Transaction本体フィールド等)には直接書き込まない。
 */
export interface AISuggestion {
  id: string;
  businessId: string;
  kind: SuggestionKind;
  target: SuggestionTarget;
  status: SuggestionStatus;
  /** 提案値。処理失敗時はnull */
  payload: SuggestionPayload | null;
  /** 提案全体の信頼度 0..1 */
  confidence: number;
  /** 提案の根拠。AIが返さない場合はシステム生成の説明を入れる */
  reason: string;
  /** needs_reviewになった理由のコード列(例: "amount_unreadable") */
  issues: string[];
  /** 実行回数。retryで増える */
  attempts: number;
  /** 再実行可能か(needs_reviewの間はtrue) */
  retriable: boolean;
  lastError: SuggestionError | null;
  /** 承認/拒否したユーザー */
  decidedBy: string | null;
  decidedAt: Date | null;
  /** ユーザーが拒否時に入力した理由 */
  rejectReason: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type NewAISuggestion = Omit<AISuggestion, "id">;

/** 監査ログエントリ。証憑内容・個人情報は含めず対象の識別情報のみ */
export interface AuditLogEntry {
  actorUid: string;
  action: "run_ai" | "approve_ai" | "reject_ai";
  targetPath: string;
  createdAt: Date;
}
