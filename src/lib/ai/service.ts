import { AIProcessingError, AITimeoutError } from "./errors";
import type { AIProvider, AIRequest } from "./provider";
import {
  defaultConfidence,
  fallbackReason,
  normalizeAIResponse,
} from "./schemas";
import type { AISuggestionStore, SuggestionListFilter } from "./store";
import type {
  AISuggestion,
  NewAISuggestion,
  SuggestionError,
  SuggestionKind,
  SuggestionStatus,
  SuggestionTarget,
} from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface RunSuggestionParams {
  businessId: string;
  kind: SuggestionKind;
  target: SuggestionTarget;
  input: Record<string, unknown>;
  actorUid: string;
}

export interface AISuggestionServiceDeps {
  store: AISuggestionStore;
  provider: AIProvider;
  timeoutMs?: number;
  now?: () => Date;
}

/**
 * AI提案のライフサイクル管理。
 *
 * 重要: このサービスは提案レコード(aiSuggestions)のみを操作する。
 * 確定データ(Transactionの account/amount/status 等)には一切書き込まない。
 * 提案の採用=ユーザーが確定値へコピーする別操作であり、
 * acceptしてもTransactionのstatusはconfirmedにならない。
 */
export class AISuggestionService {
  private readonly store: AISuggestionStore;
  private readonly provider: AIProvider;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(deps: AISuggestionServiceDeps) {
    this.store = deps.store;
    this.provider = deps.provider;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * AI処理を実行して提案レコードを作成する。
   * 成功 → status: pending
   * 判断不能(必須項目の欠落) → status: needs_review
   * 失敗(タイムアウト・不正レスポンス) → status: needs_review + lastError、再実行可能
   */
  async run(params: RunSuggestionParams): Promise<AISuggestion> {
    const createdAt = this.now();
    const base: NewAISuggestion = {
      businessId: params.businessId,
      kind: params.kind,
      target: params.target,
      status: "pending",
      payload: null,
      confidence: 0,
      reason: "",
      issues: [],
      attempts: 0,
      retriable: true,
      lastError: null,
      decidedBy: null,
      decidedAt: null,
      rejectReason: null,
      createdBy: params.actorUid,
      createdAt,
      updatedAt: createdAt,
    };

    const id = await this.store.create(params.businessId, base);
    return this.execute(params.businessId, id, params);
  }

  /** 単一提案の取得(存在しなければnull) */
  async get(businessId: string, id: string): Promise<AISuggestion | null> {
    return this.store.get(businessId, id);
  }

  /** 提案一覧(createdAt降順)。条件はfilterで絞り込む */
  async list(
    businessId: string,
    filter: SuggestionListFilter = {},
  ): Promise<AISuggestion[]> {
    return this.store.list(businessId, filter);
  }

  /** 失敗・判断不能の提案を再実行する。accepted/rejectedは再実行不可 */
  async retry(
    businessId: string,
    id: string,
    actorUid: string,
    input: Record<string, unknown>,
  ): Promise<AISuggestion> {
    const suggestion = await this.requireSuggestion(businessId, id);
    if (suggestion.status === "accepted" || suggestion.status === "rejected") {
      throw new Error(
        `suggestion ${id} is ${suggestion.status} and cannot be retried`,
      );
    }
    return this.execute(businessId, id, {
      businessId,
      kind: suggestion.kind,
      target: suggestion.target,
      input,
      actorUid,
    });
  }

  /**
   * 提案を承認状態にする。
   * 注意: 確定値への反映は行わない。ユーザーが別途確定操作を行う。
   */
  async accept(
    businessId: string,
    id: string,
    actorUid: string,
  ): Promise<AISuggestion> {
    const suggestion = await this.requireSuggestion(businessId, id);
    this.assertDecidable(suggestion, "accept");
    const now = this.now();
    await this.store.update(businessId, id, {
      status: "accepted",
      retriable: false,
      decidedBy: actorUid,
      decidedAt: now,
      updatedAt: now,
    });
    await this.appendAudit(businessId, actorUid, "approve_ai", suggestion);
    return this.requireSuggestion(businessId, id);
  }

  /** 提案を拒否する。ユーザーが理由を残せる */
  async reject(
    businessId: string,
    id: string,
    actorUid: string,
    rejectReason?: string,
  ): Promise<AISuggestion> {
    const suggestion = await this.requireSuggestion(businessId, id);
    this.assertDecidable(suggestion, "reject");
    const now = this.now();
    await this.store.update(businessId, id, {
      status: "rejected",
      retriable: false,
      decidedBy: actorUid,
      decidedAt: now,
      rejectReason: rejectReason ?? null,
      updatedAt: now,
    });
    await this.appendAudit(businessId, actorUid, "reject_ai", suggestion);
    return this.requireSuggestion(businessId, id);
  }

  private async execute(
    businessId: string,
    id: string,
    params: RunSuggestionParams,
  ): Promise<AISuggestion> {
    const request: AIRequest = {
      kind: params.kind,
      businessId,
      target: params.target,
      input: params.input,
    };

    try {
      const raw = await withTimeout(
        this.provider.generate(request),
        this.timeoutMs,
      );
      const normalized = normalizeAIResponse(params.kind, raw);
      const status: SuggestionStatus =
        normalized.issues.length > 0 ? "needs_review" : "pending";
      const reason =
        normalized.reason ?? fallbackReason(params.kind, normalized.issues);

      await this.store.update(businessId, id, {
        status,
        payload: normalized.payload,
        confidence: normalized.confidence ?? defaultConfidence(params.kind),
        reason,
        issues: normalized.issues,
        attempts: (await this.attempts(businessId, id)) + 1,
        retriable: true,
        lastError: null,
        updatedAt: this.now(),
      });
    } catch (error) {
      const suggestionError = toSuggestionError(error);
      await this.store.update(businessId, id, {
        status: "needs_review",
        payload: null,
        confidence: 0,
        reason: fallbackReason(params.kind, [suggestionError.code]),
        issues: [suggestionError.code],
        attempts: (await this.attempts(businessId, id)) + 1,
        retriable: true,
        lastError: suggestionError,
        updatedAt: this.now(),
      });
    }

    const suggestion = await this.requireSuggestion(businessId, id);
    await this.appendAudit(businessId, params.actorUid, "run_ai", suggestion);
    return suggestion;
  }

  private async attempts(businessId: string, id: string): Promise<number> {
    const current = await this.requireSuggestion(businessId, id);
    return current.attempts;
  }

  private async requireSuggestion(
    businessId: string,
    id: string,
  ): Promise<AISuggestion> {
    const suggestion = await this.store.get(businessId, id);
    if (!suggestion) throw new Error(`suggestion not found: ${id}`);
    return suggestion;
  }

  private assertDecidable(suggestion: AISuggestion, action: string): void {
    if (suggestion.status === "accepted" || suggestion.status === "rejected") {
      throw new Error(
        `suggestion ${suggestion.id} is already ${suggestion.status} and cannot be ${action}ed`,
      );
    }
  }

  private async appendAudit(
    businessId: string,
    actorUid: string,
    action: "run_ai" | "approve_ai" | "reject_ai",
    suggestion: AISuggestion,
  ): Promise<void> {
    await this.store.appendAuditLog(businessId, {
      actorUid,
      action,
      targetPath: `businesses/${businessId}/aiSuggestions/${suggestion.id}`,
      createdAt: this.now(),
    });
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AITimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function toSuggestionError(error: unknown): SuggestionError {
  if (error instanceof AIProcessingError) {
    return { code: error.code, message: error.message };
  }
  // プロバイダ固有のエラーメッセージは個人情報を含み得るため汎用化する
  return { code: "provider_error", message: "AI provider request failed" };
}
