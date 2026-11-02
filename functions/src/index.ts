/**
 * Cloud Functions エントリポイント(Issue #147)。
 * export名がそのままデプロイ時の関数名になる。
 * 各関数の実装は functions/src 配下を参照。
 */
export { exportStaleBackupsDaily } from "./backup";
export { generateRecurringInvoicesDaily } from "./recurring-invoices";
