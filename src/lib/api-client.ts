"use client";

import type {
  AISuggestionJSON,
  SuggestionKind,
  SuggestionStatus,
  SuggestionTarget,
  SuggestionTargetType,
} from "@/lib/ai/types";
import type { ActionResult } from "@/lib/api/result";
import type { RestoreSummary } from "@/lib/backup";
import { getFirebaseAuth } from "@/lib/firebase/client";

/**
 * Server Action 呼び出しラッパー。
 * - UNAUTHORIZED が返った場合はIDトークンを再取得してセッションCookieを
 *   更新し、1回だけリトライする(Cookie失効対策)
 * - 失敗は ApiClientError として throw し、画面側でエラー状態を表示する
 */
export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

// ---------- 耐障害性(タイムアウト・リトライ・セッション切れ) ----------

/** fetchのデフォルトタイムアウト。OCR等の重い処理は個別に延長する */
const DEFAULT_TIMEOUT_MS = 20_000;
/** セッション発行/破棄は軽量なので短めに */
const SESSION_REQUEST_TIMEOUT_MS = 10_000;
/** 429時の自動リトライ上限(初回+最大2回=計3回試行) */
const MAX_RATE_LIMIT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
/**
 * 自動リトライの待機上限。レート制限ウィンドウは最大1時間のため、
 * 長いRetry-Afterに従うと画面が固まる。上限超過はリトライせずエラーにする
 */
const MAX_RETRY_DELAY_MS = 30_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * タイムアウト付きfetch。呼び出し側の signal(init.signal)があれば併用し、
 * どちらかが発火すれば中断する。失敗は ApiClientError に正規化する:
 * TIMEOUT(自前のタイマー) / ABORTED(呼び出し側の中断) / NETWORK(その他)。
 */
async function fetchWithTimeout(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal ?? null;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(path, {
      credentials: "same-origin",
      ...init,
      signal: controller.signal,
    });
  } catch (e) {
    if (timedOut) {
      throw new ApiClientError(
        "TIMEOUT",
        "通信がタイムアウトしました。しばらくしてから再試行してください",
      );
    }
    if (
      callerSignal?.aborted ||
      (e instanceof DOMException && e.name === "AbortError")
    ) {
      throw new ApiClientError("ABORTED", "通信が中断されました");
    }
    throw new ApiClientError(
      "NETWORK",
      "通信に失敗しました。ネットワーク接続を確認してください",
    );
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * 429リトライの待機時間(ms)。Retry-After(秒数 or HTTP-date)があれば
 * 上限内ならその値を採用し、上限超過・過去日時なら null(=リトライしない)。
 * ヘッダが無い/解釈不能なら 500ms*2^attempt の指数バックオフ(上限あり)。
 */
function retryDelayMs(retryAfter: string | null, attempt: number): number | null {
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (Number.isFinite(sec) && sec >= 0) {
      const ms = sec * 1000;
      return ms <= MAX_RETRY_DELAY_MS ? ms : null;
    }
    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) {
      const ms = dateMs - Date.now();
      return ms >= 0 && ms <= MAX_RETRY_DELAY_MS ? ms : null;
    }
  }
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

/**
 * セッション切れ(401が再発行後も解消しない)時のコールバック。
 * 既定はFirebaseサインアウト。onIdTokenChanged → status=signed_out →
 * AppShellの認証ゲートが next パラメータ付きで /login へ遷移する。
 */
let sessionExpiredHandler: (() => void | Promise<void>) | null = null;
let lastSessionExpiredAt = 0;
/** 同時401の多発でハンドラが連打されるのを防ぐ無限ループ対策 */
const SESSION_EXPIRED_DEBOUNCE_MS = 10_000;

/**
 * セッション切れ時のコールバックを差し替える。null で既定(Firebase
 * サインアウト→/login遷移)に戻る。設定し直すとデバウンスも解除される。
 */
export function setSessionExpiredHandler(
  handler: (() => void | Promise<void>) | null,
): void {
  sessionExpiredHandler = handler;
  lastSessionExpiredAt = 0;
}

async function handleSessionExpired(): Promise<void> {
  const now = Date.now();
  if (now - lastSessionExpiredAt < SESSION_EXPIRED_DEBOUNCE_MS) return;
  lastSessionExpiredAt = now;
  try {
    await (sessionExpiredHandler ??
      (() => getFirebaseAuth().signOut()))();
  } catch {
    // ハンドラ失敗時も元の401エラーは呼び出し側へ返す
  }
}

/**
 * 現在のIDトークンでセッションCookieを更新する。未ログインなら false。
 * トークン再取得失敗(アカウント無効化・通信断)やPOST失敗も false に
 * 正規化し、呼び出し側へ生の FirebaseError を伝播させない。
 */
export async function refreshSession(forceRefresh = false): Promise<boolean> {
  try {
    const user = getFirebaseAuth().currentUser;
    if (!user) return false;
    const idToken = await user.getIdToken(forceRefresh);
    const res = await fetchWithTimeout(
      "/api/session",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
      SESSION_REQUEST_TIMEOUT_MS,
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await fetchWithTimeout(
      "/api/session",
      { method: "DELETE" },
      SESSION_REQUEST_TIMEOUT_MS,
    );
  } catch {
    // ネットワーク断でもクライアント側ログアウトは進める
  }
}

export async function callApi<T>(
  action: () => Promise<ActionResult<T>>,
): Promise<T> {
  let res = await action();
  if (!res.ok && res.error.code === "UNAUTHORIZED") {
    // Cookie切れの可能性。トークン再取得でセッションを張り直してリトライ
    if (await refreshSession(true)) {
      res = await action();
    }
  }
  if (!res.ok) {
    if (res.error.code === "UNAUTHORIZED") {
      // 再発行後も認証が通らない = セッション本体が失効。
      // サインアウト→認証ゲートの /login 遷移に委ねる(デバウンス済み)
      await handleSessionExpired();
    }
    throw new ApiClientError(res.error.code, res.error.message);
  }
  return res.data;
}

// ---------- AI提案 API(/api/ai/suggestions) ----------

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface RequestOptions {
  /** デフォルト20秒。OCR・バックアップ復元等の重い処理のみ延長する */
  timeoutMs?: number;
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  opts?: RequestOptions,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  // 429の自動リトライはGET/HEADのみ。POST/PATCH等はサーバー側で
  // 処理済みか判別できず二重実行の恐れがあるため再送しない
  const idempotent = method === "GET" || method === "HEAD";
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let sessionRefreshed = false;
  let rateLimitRetries = 0;
  let res: Response;
  for (;;) {
    res = await fetchWithTimeout(path, init, timeoutMs);
    if (res.status === 401 && !sessionRefreshed) {
      // セッションCookie切れの可能性。IDトークンから張り直して1回だけ再送。
      // 401は認証段階で拒否済みのため副作用リクエストの再送も安全
      sessionRefreshed = true;
      if (await refreshSession(true)) continue;
      break;
    }
    if (
      res.status === 429 &&
      idempotent &&
      rateLimitRetries < MAX_RATE_LIMIT_RETRIES
    ) {
      const delay = retryDelayMs(
        res.headers.get("retry-after"),
        rateLimitRetries,
      );
      if (delay !== null) {
        rateLimitRetries += 1;
        await sleep(delay);
        continue;
      }
    }
    break;
  }

  if (res.status === 401) {
    // 再発行後も401 = セッション本体が失効。認証ゲート経由で /login へ
    await handleSessionExpired();
  }

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !body?.ok) {
    throw new ApiClientError(
      body?.error?.code ?? "INTERNAL",
      body?.error?.message ?? "通信に失敗しました",
    );
  }
  return body.data as T;
}

/** 提案一覧。絞り込み条件はGETクエリ相当 */
export async function fetchAiSuggestions(
  businessId: string,
  filter: {
    targetType?: SuggestionTargetType;
    targetId?: string;
    kind?: SuggestionKind;
    status?: SuggestionStatus;
    limit?: number;
  } = {},
): Promise<AISuggestionJSON[]> {
  const params = new URLSearchParams({ businessId });
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return requestJson<AISuggestionJSON[]>(`/api/ai/suggestions?${params}`);
}

/** AI提案を実行する(対象・種別はサーバー側でも検証される) */
export async function runAiSuggestion(
  businessId: string,
  kind: SuggestionKind,
  target: SuggestionTarget,
  input: Record<string, unknown> = {},
): Promise<AISuggestionJSON> {
  return requestJson<AISuggestionJSON>("/api/ai/suggestions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessId, kind, target, input }),
  });
}

/** 提案を承認(accepted)・却下(rejected)する。確定データへの反映は行われない */
export async function decideAiSuggestion(
  businessId: string,
  suggestionId: string,
  decision: "accepted" | "rejected",
  rejectReason?: string,
): Promise<AISuggestionJSON> {
  return requestJson<AISuggestionJSON>(`/api/ai/suggestions/${suggestionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ businessId, decision, rejectReason }),
  });
}

// ---------- 領収書OCR API(/api/ai/receipt-ocr) ----------

/** POST /api/ai/receipt-ocr の抽出結果。読み取れなかった項目はnull */
export interface ReceiptOcrResult {
  amount: number | null;
  date: string | null;
  vendor: string | null;
  confidence: number;
  reason: string;
  issues: string[];
}

/** OCRの利用可否(AI_OCR_PROVIDER等の設定状態)を問い合わせる */
export async function fetchReceiptOcrAvailability(
  businessId: string,
): Promise<{ available: boolean }> {
  const params = new URLSearchParams({ businessId });
  return requestJson<{ available: boolean }>(`/api/ai/receipt-ocr?${params}`);
}

/**
 * 証憑をOCRし、日付・金額・取引先の抽出値を返す。
 * サーバー側でStorageからファイルを取得して処理する(画像は送信しない)。
 * 確定データには保存されず、フォームへの自動入力用。
 */
export async function runReceiptOcr(
  businessId: string,
  receiptId: string,
): Promise<ReceiptOcrResult> {
  return requestJson<ReceiptOcrResult>(
    "/api/ai/receipt-ocr",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId, receiptId }),
    },
    // サーバー側でLLM呼び出しを伴うため個別に延長
    { timeoutMs: 60_000 },
  );
}

// ---------- AI使用量 API(/api/ai/usage) ----------

export interface AiUsage {
  /** 現在ウィンドウ(1時間)のAI提案実行の残り回数 */
  remaining: number;
  /** ウィンドウあたりの上限回数 */
  limit: number;
}

/**
 * AI提案実行の残り回数を問い合わせる(ダッシュボード等の表示用)。
 * 回数は消費しない。失敗時は呼び出し側で非表示にフォールバックする。
 */
export async function fetchAiUsage(businessId: string): Promise<AiUsage> {
  const params = new URLSearchParams({ businessId });
  return requestJson<AiUsage>(`/api/ai/usage?${params}`);
}

// ---------- バックアップ API(/api/backup) ----------

/**
 * バックアップJSONを事業へ復元する(ownerのみ)。
 * backup はクライアント側で backupFileSchema 検証済みのオブジェクト。
 * 既存データは残り、ID衝突時はサーバー側で新規採番される。
 */
export async function restoreBackup(
  businessId: string,
  backup: unknown,
): Promise<RestoreSummary> {
  return requestJson<RestoreSummary>(
    "/api/backup",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ businessId, backup }),
    },
    // 全件書き込みのため時間がかかり得る
    { timeoutMs: 60_000 },
  );
}
