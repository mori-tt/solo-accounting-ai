import {
  ConsoleMonitoringProvider,
  createMonitoringProvider,
  NoopMonitoringProvider,
} from "./provider";
import type {
  CaptureContext,
  MonitoringLevel,
  MonitoringProvider,
} from "./types";

/**
 * エラー監視の公開窓口。
 * Route Handler / Server Action 等の catch から呼ぶ。
 * これらの関数自体は絶対に例外を投げない(監視経路の障害で
 * 本体処理を落とさない)。個人情報・証憑内容は error message や
 * context に含めないこと(logger.ts のフィルタ方針参照)。
 */

let provider: MonitoringProvider | undefined;

function getProvider(): MonitoringProvider {
  provider ??= createMonitoringProvider();
  return provider;
}

/** 例外を監視バックエンドへ送る。未設定環境ではconsole構造化ログへ */
export function captureException(
  error: unknown,
  context?: CaptureContext,
): void {
  try {
    getProvider().captureException(error, context);
  } catch {
    // プロバイダ障害は握りつぶす(no-op で安全側にフォールバック)
  }
}

/** イベント・障害メッセージを監視バックエンドへ送る */
export function captureMessage(
  message: string,
  level: MonitoringLevel = "info",
  context?: CaptureContext,
): void {
  try {
    getProvider().captureMessage(message, level, context);
  } catch {
    // 同上
  }
}

/** テスト用: プロバイダを差し替える(NoopMonitoringProvider 等を注入) */
export function setMonitoringProviderForTest(p: MonitoringProvider): void {
  provider = p;
}

/** テスト用: プロバイダのメモ化をリセットする */
export function resetMonitoringForTest(): void {
  provider = undefined;
}

export {
  ConsoleMonitoringProvider,
  createMonitoringProvider,
  NoopMonitoringProvider,
};
export { createLogger, logger, sanitizeLogFields, serializeError } from "./logger";
export type {
  LogEntry,
  Logger,
  LogFields,
  LogLevel,
  LogSink,
} from "./logger";
export type {
  CaptureContext,
  MonitoringLevel,
  MonitoringProvider,
} from "./types";
