/**
 * 構造化ログの薄いラッパ。
 *
 * 方針(AGENTS.md「個人情報や証憑内容をログ出力しない」):
 * - msg は開発者が書く固定文言のみ。ユーザー入力・証憑内容を埋め込まない
 * - fields はスカラー値のみ。キーがPII・証憑内容を示唆するものは除去し、
 *   除去したキー名を redactedKeys に記録する(多層防御。呼び出し側が
 *   個人情報を渡さない設計が前提)
 * - 文字列値はメールアドレス様の部分をマスクし、長さを打ち切る
 * - 出力はJSON 1行。集約基盤へそのまま流せる形にする
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** fields に許容する値。ネストしたオブジェクト・配列は渡さない */
export type LogFieldValue = string | number | boolean | null;
export type LogFields = Record<string, LogFieldValue | undefined>;

/** 1行分の構造化ログ */
export interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  err?: { name: string; message: string; stack?: string };
  /** フィルタで除去したフィールド名(値は記録しない) */
  redactedKeys?: string[];
  [field: string]: unknown;
}

export type LogSink = (entry: LogEntry) => void;

export interface LoggerOptions {
  /** このレベル未満のログは捨てる。省略時は env LOG_LEVEL → info */
  minLevel?: LogLevel;
  sink?: LogSink;
  now?: () => Date;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** エントリ自身が使う予約キー。同名フィールドは衝突するため除去対象 */
const RESERVED_KEYS = new Set(["level", "msg", "ts", "err", "redactedKeys"]);

/**
 * 個人情報・証憑内容・認証情報を保持し得るフィールド名のパターン。
 * 誤検知で安全側に倒す。相関IDなどの識別子は traceId 等の安全な
 * キー名で渡すこと。
 */
const SENSITIVE_KEY_RE =
  /(password|passwd|secret|token|credential|api[-_]?key|cookie|session|authoriz|auth[-_]|bearer|email|mail|phone|tel|fax|address|postal|zip|birth|gender|name|uid|user[-_]?id|receipt|invoice|ocr|image|photo|file|blob|base64|content|body|payload|input|output|raw|data|description|memo|note|remark|text|detail|header|request|response|query|string)/i;

/** 値に含まれるメールアドレス様の文字列 */
const EMAILISH_RE = /[^\s@]+@[^\s@]+/g;

const MAX_FIELD_STRING = 200;
const MAX_ERROR_STRING = 1000;
const MAX_FIELDS = 32;

function isLogLevel(v: string | undefined): v is LogLevel {
  return v === "debug" || v === "info" || v === "warn" || v === "error";
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function sanitizeString(s: string, max: number): string {
  return truncate(s.replace(EMAILISH_RE, "[redacted]"), max);
}

/**
 * fields をサニタイズしてエントリへ平準化する。
 * スカラー以外・PII系キー・予約キーは除去し redactedKeys に列挙する。
 */
export function sanitizeLogFields(fields: Record<string, unknown> | undefined): {
  fields: Record<string, LogFieldValue>;
  redactedKeys: string[];
} {
  const out: Record<string, LogFieldValue> = {};
  const redacted: string[] = [];
  if (!fields) return { fields: out, redactedKeys: redacted };
  for (const [key, raw] of Object.entries(fields)) {
    if (Object.keys(out).length >= MAX_FIELDS) {
      redacted.push(key);
      continue;
    }
    if (RESERVED_KEYS.has(key) || SENSITIVE_KEY_RE.test(key)) {
      redacted.push(key);
      continue;
    }
    const v = sanitizeFieldValue(raw);
    if (v === undefined) {
      redacted.push(key);
      continue;
    }
    out[key] = v;
  }
  return { fields: out, redactedKeys: redacted };
}

function sanitizeFieldValue(v: unknown): LogFieldValue | undefined {
  switch (typeof v) {
    case "string":
      return sanitizeString(v, MAX_FIELD_STRING);
    case "number":
      return Number.isFinite(v) ? v : undefined;
    case "boolean":
      return v;
    case "bigint":
      return String(v);
    default:
      // null は明示的に残す。undefined/object/function/symbol は除去
      return v === null ? null : undefined;
  }
}

/** Error を安全な形に畳む。message/stack もマスク・打ち切り対象 */
export function serializeError(error: unknown): LogEntry["err"] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeString(error.message, MAX_ERROR_STRING),
      stack: error.stack
        ? sanitizeString(error.stack, MAX_ERROR_STRING)
        : undefined,
    };
  }
  return { name: "NonError", message: sanitizeString(String(error), 200) };
}

function minLevelFromEnv(env: NodeJS.ProcessEnv = process.env): LogLevel {
  return isLogLevel(env.LOG_LEVEL) ? env.LOG_LEVEL : "info";
}

function consoleSink(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  switch (entry.level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Errorオブジェクトを畳んで error レベルで出力する */
  exception(msg: string, error: unknown, fields?: LogFields): void;
}

/**
 * 構造化ロガーを作る。
 * sink はデフォルト console(JSON 1行)。minLevel 未指定時は呼び出し毎に
 * LOG_LEVEL を読む(env変更をテストで反映しやすくするため遅延評価)。
 * ログ出力自体が例外を投げることはない(sink 障害は握りつぶす)。
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());

  function write(
    level: LogLevel,
    msg: string,
    error: unknown | undefined,
    fields: LogFields | undefined,
  ): void {
    try {
      const min = options.minLevel ?? minLevelFromEnv();
      if (LEVEL_ORDER[level] < LEVEL_ORDER[min]) return;
      const { fields: safe, redactedKeys } = sanitizeLogFields(fields);
      const entry: LogEntry = {
        level,
        msg: sanitizeString(msg, MAX_ERROR_STRING),
        ts: now().toISOString(),
        ...safe,
      };
      if (error !== undefined) entry.err = serializeError(error);
      if (redactedKeys.length > 0) entry.redactedKeys = redactedKeys;
      sink(entry);
    } catch {
      // ログ経路の障害で本体処理を落とさない
    }
  }

  return {
    debug: (msg, fields) => write("debug", msg, undefined, fields),
    info: (msg, fields) => write("info", msg, undefined, fields),
    warn: (msg, fields) => write("warn", msg, undefined, fields),
    error: (msg, fields) => write("error", msg, undefined, fields),
    exception: (msg, error, fields) => write("error", msg, error, fields),
  };
}

/** 共有ロガー。アプリコードは原則これを使う */
export const logger: Logger = createLogger();
