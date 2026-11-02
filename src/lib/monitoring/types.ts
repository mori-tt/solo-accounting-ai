/**
 * エラー監視の共通型。
 * バックエンド(Sentry等)に依存しない最小の表面だけを定義する。
 */

/** 通知レベル。外部SaaSの severity と対応させる */
export type MonitoringLevel = "fatal" | "error" | "warning" | "info" | "debug";

/**
 * 捕捉時に添える補足情報。
 * AGENTS.md「個人情報や証憑内容をログ出力しない」に従い、
 * 氏名・メールアドレス・証憑のOCRテキスト・摘要等のコンテンツは
 * 絶対に含めないこと。値は送信前に構造化ログ(logger.ts)と同じ
 * サニタイズを通すが、フィルタは多層防御であり呼び出し側の設計が前提。
 */
export interface CaptureContext {
  /** 分類・検索用タグ(例: { feature: "backup" })。キー・値とも非個人情報のみ */
  tags?: Record<string, string>;
  /** 診断用メタデータ。スカラー値のみ残り、PII系キー・値は除去される */
  extra?: Record<string, unknown>;
}

/**
 * エラー監視バックエンドの抽象。
 * 実装は外部SaaSでもconsole出力でもよい。メソッドは
 * 同期シグネチャ(配送の失敗で本体処理を妨げない)で、内部で例外を投げないこと。
 */
export interface MonitoringProvider {
  captureException(error: unknown, context?: CaptureContext): void;
  captureMessage(
    message: string,
    level?: MonitoringLevel,
    context?: CaptureContext,
  ): void;
}
