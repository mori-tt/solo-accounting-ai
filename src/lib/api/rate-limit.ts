import { ApiError } from "./result";

/**
 * 簡易レート制限(インメモリ・固定ウィンドウ)。
 * サーバーレス/マルチインスタンス環境ではインスタンス単位の
 * 最良努力(best effort)制限となる。厳密な制限が必要になったら
 * Firestore/Redis等の共有ストアへ置き換えること。
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** ウィンドウあたりの許容回数 */
  limit: number;
  /** ウィンドウ幅(ミリ秒) */
  windowMs: number;
}

export interface RateLimiter {
  /**
   * key(通常はbusinessId)1回分を消費する。
   * 上限超過時は RateLimitError(ApiError RATE_LIMITED)を投げる。
   */
  consume(key: string): void;
  /** 現在の残り回数(超過後の表示用) */
  remaining(key: string): number;
  /** テスト用: 全バケットを破棄する */
  reset(): void;
}

/** 上限超過時のエラー。toErrorResponse が retryAfterSec → Retry-After に変換する */
export class RateLimitError extends ApiError {
  constructor(
    message: string,
    readonly retryAfterSec: number,
  ) {
    super("RATE_LIMITED", message);
    this.name = "RateLimitError";
  }
}

// Mapの無制限な増大を防ぐ上限(溢れそうなら期限切れバケットを掃除)
const MAX_KEYS = 10_000;

export function createRateLimiter(
  rule: RateLimitRule,
  now: () => number = () => Date.now(),
): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function sweepExpired(nowMs: number): void {
    for (const [key, bucket] of buckets) {
      if (nowMs >= bucket.resetAt) buckets.delete(key);
    }
  }

  return {
    consume(key: string) {
      const nowMs = now();
      if (buckets.size >= MAX_KEYS) sweepExpired(nowMs);

      const bucket = buckets.get(key);
      if (!bucket || nowMs >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: nowMs + rule.windowMs });
        return;
      }
      bucket.count += 1;
      if (bucket.count > rule.limit) {
        throw new RateLimitError(
          "リクエストが多すぎます。しばらく待ってから再試行してください",
          Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000)),
        );
      }
    },
    remaining(key: string) {
      const bucket = buckets.get(key);
      if (!bucket || now() >= bucket.resetAt) return rule.limit;
      return Math.max(0, rule.limit - bucket.count);
    },
    reset() {
      buckets.clear();
    },
  };
}

/**
 * /api/ai/* 用のレート制限(businessId単位・1時間窓)。
 * - RUN: AI提案生成(LLM/外部API呼び出しを伴うため厳しめに60回/時)
 * - READ_WRITE: 一覧取得・承認/却下(240回/時)
 */
export const AI_RUN_LIMIT_PER_HOUR = 60;

export const aiRunRateLimiter = createRateLimiter({
  limit: AI_RUN_LIMIT_PER_HOUR,
  windowMs: 60 * 60 * 1000,
});

export const aiApiRateLimiter = createRateLimiter({
  limit: 240,
  windowMs: 60 * 60 * 1000,
});
