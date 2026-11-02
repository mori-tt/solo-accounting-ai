import { logger, type LogFields } from "./logger";
import type {
  CaptureContext,
  MonitoringLevel,
  MonitoringProvider,
} from "./types";

/**
 * 監視プロバイダの選択とフォールバック実装。
 *
 * SDK本体(@sentry/nextjs等)は未同梱(Issue #83 は抽象層のみ)。
 * SENTRY_DSN 設定時に外部送信を行う実装は、SDK導入タスクで
 * createMonitoringProvider に追加する。それまではconsole出力に
 * フォールバックし、外部配送は no-op とする。
 */

function contextToFields(context: CaptureContext | undefined): LogFields {
  if (!context) return {};
  const fields: Record<string, unknown> = { ...context.extra };
  // tags は検索用のため "tag." 接頭辞で畳み込む(キーは別途フィルタされる)
  for (const [key, value] of Object.entries(context.tags ?? {})) {
    fields[`tag.${key}`] = value;
  }
  return fields as LogFields;
}

/**
 * consoleへ構造化出力するフォールバックプロバイダ。
 * 個人情報・証憑内容は logger のフィルタで除去されるが、
 * 呼び出し側も context にコンテンツを含めないこと。
 */
export class ConsoleMonitoringProvider implements MonitoringProvider {
  captureException(error: unknown, context?: CaptureContext): void {
    logger.exception("monitoring captured exception", error, {
      ...contextToFields(context),
      kind: "exception",
    });
  }

  captureMessage(
    message: string,
    level: MonitoringLevel = "info",
    context?: CaptureContext,
  ): void {
    const fields = {
      ...contextToFields(context),
      kind: "message",
    };
    switch (level) {
      case "fatal":
      case "error":
        logger.error(message, fields);
        break;
      case "warning":
        logger.warn(message, fields);
        break;
      case "debug":
        logger.debug(message, fields);
        break;
      default:
        logger.info(message, fields);
    }
  }
}

/**
 * 何もしないプロバイダ。テストや「監視自体を無効化したい」文脈向け。
 * setMonitoringProviderForTest で注入して使う。
 */
export class NoopMonitoringProvider implements MonitoringProvider {
  captureException(): void {}
  captureMessage(): void {}
}

/**
 * 環境変数から MonitoringProvider を構築する。
 *
 * - `SENTRY_DSN` 設定時: SDK未同梱のため現状はconsoleフォールバック。
 *   SDK導入後はここで Sentry 実装を返す
 * - 未設定時: console出力 + 外部配送 no-op(監視未設定でも本体機能を妨げない)
 */
export function createMonitoringProvider(
  env: Record<string, string | undefined> = process.env,
): MonitoringProvider {
  if (env.SENTRY_DSN?.trim()) {
    // 設定値の有無のみを通知し、DSNの値自体は出力しない
    console.warn(
      "[monitoring] SENTRY_DSN is set but no Sentry SDK is installed; " +
        "using console fallback (no events are sent externally)",
    );
  }
  return new ConsoleMonitoringProvider();
}
