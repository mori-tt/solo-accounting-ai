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
 * - READ_WRITE: 一覧取得・承認/却下・利用可否や残数の読み取り(240回/時)
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

/**
 * businessId を持たないエンドポイント(認証系)向けに、
 * クライアントIPをレート制限キーとして取り出す。
 *
 * x-forwarded-for の先頭はクライアント制御で偽装・回転できるため、
 * 直近プロキシが追記する最右エントリを採用し、なければ
 * x-real-ip(インフラが付与するケース)にフォールバックする。
 * 完全な偽装防止はインフラ依存のため最良努力であり、
 * IP回転への第二防御としてレート制限値自体を低めに設定している。
 */
export function clientIpKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

/**
 * /api/session 用(IP単位・1時間窓)。
 * IDトークン検証は署名検証コストがあるため、ログイン+トークン更新の
 * 正常利用(時間あたり数回)を大きく上回る30回/時で制限する。
 */
export const sessionRateLimiter = createRateLimiter({
  limit: 30,
  windowMs: 60 * 60 * 1000,
});

/**
 * /api/backup 用(businessId単位・1時間窓)。
 * - EXPORT: 事業の全データを読み出す重い処理(30回/時)
 * - RESTORE: 全件書き込みを伴うためさらに厳しめ(10回/時)
 */
export const backupExportRateLimiter = createRateLimiter({
  limit: 30,
  windowMs: 60 * 60 * 1000,
});

export const backupRestoreRateLimiter = createRateLimiter({
  limit: 10,
  windowMs: 60 * 60 * 1000,
});

/**
 * /api/receipts 用(businessId単位・1時間窓)。
 * - UPLOAD: Storage書き込み+帯域の課金対象(120回/時)
 * - DOWNLOAD: 一覧の<img>表示でまとめて要求されるため緩め(1200回/時)
 */
export const receiptUploadRateLimiter = createRateLimiter({
  limit: 120,
  windowMs: 60 * 60 * 1000,
});

export const receiptDownloadRateLimiter = createRateLimiter({
  limit: 1200,
  windowMs: 60 * 60 * 1000,
});

/**
 * 事業作成用(uid単位・1日窓)。
 * businessId単位のレート制限は新規事業作成で枠を増やせるため、
 * 作成数自体を1ユーザーあたり20件/日で制限する。
 */
export const businessCreateRateLimiter = createRateLimiter({
  limit: 20,
  windowMs: 24 * 60 * 60 * 1000,
});

/**
 * Server Actions 用のレート制限(1時間窓)。
 * Route Handler 用と同じインメモリの最良努力制限。
 * 消費は各アクション内で require*(認可)通過後に行い、
 * 非メンバーが事業の枠を消費できないようにする。
 *
 * - READ(uid単位): viewer以上の参照系アクション。
 *   getDashboard や総勘定元帳のように全取引を読む重い集計が
 *   画面遷移のたびに走るため、R2-18 の指摘に基づきユーザー単位で
 *   制限する(600回/時 = 平均毎分10回。画面操作+自動再取得を許容する余裕)。
 * - WRITE(businessId単位): editor以上の変更系アクション。
 *   銀行CSVインポートが行ごとに登録アクションを呼ぶため、
 *   千件規模の一括取込と通常入力を許容する1200回/時で制限する。
 * - BULK(businessId単位): 一括生成・締め・事業削除など
 *   1回の呼出で大量の読み書きを行う操作(60回/時)。
 */
export const actionReadRateLimiter = createRateLimiter({
  limit: 600,
  windowMs: 60 * 60 * 1000,
});

export const actionWriteRateLimiter = createRateLimiter({
  limit: 1200,
  windowMs: 60 * 60 * 1000,
});

export const actionBulkRateLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60 * 60 * 1000,
});
