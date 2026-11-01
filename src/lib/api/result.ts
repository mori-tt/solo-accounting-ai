import { DomainError } from "@/lib/accounting/errors";

/**
 * Server Action の戻り値。想定内の失敗は例外ではなく
 * { ok: false, error } で返し、画面側でエラー状態を表示する。
 */
export type ActionError = { code: string; message: string };

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/** 認可・認証まわりのAPIエラー。codeはActionError.codeと対応。 */
export class ApiError extends Error {
  constructor(
    readonly code:
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "INTERNAL",
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const DOMAIN_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "入力内容に誤りがあります",
  INVALID_AMOUNT: "金額は円単位の正の整数で入力してください",
  INVALID_DATE: "日付の形式が正しくありません",
  INVALID_TAX_MODE: "消費税課税方式が不正です",
  INVALID_FISCAL_MONTH: "会計年度開始月が不正です",
  INVALID_QUANTITY: "数量が不正です",
  AMOUNT_MISMATCH: "金額の合計が一致しません",
  DUE_BEFORE_ISSUE: "支払期日は発行日以降にしてください",
  NOT_FOUND: "対象のデータが見つかりません",
  PERIOD_CLOSED: "締め済み期間のデータは変更できません",
  PERIOD_OVERLAP: "期間が重複しています",
  PERIOD_NOT_OPEN: "この期間はすでに締め済みです",
  HAS_DRAFT_TRANSACTIONS: "未確定の取引が残っているため締められません",
  INVALID_STATUS_TRANSITION: "この状態では実行できない操作です",
  ALREADY_PAID: "すでに支払済み・入金済みです",
  OVERPAID: "請求額を超える入金はできません",
  SUGGESTION_NOT_FOUND: "AI提案が見つかりません",
  SUGGESTION_NOT_PENDING: "このAI提案はすでに処理済みです",
  SUGGESTION_FIELD_FORBIDDEN: "AI提案で変更できない項目が含まれています",
  INVALID_SUGGESTION: "AI提案の内容が不正です",
};

/** 例外 → ユーザー向けエラー。内部情報を漏らさない。 */
export function toActionError(e: unknown): ActionError {
  if (e instanceof ApiError) {
    return { code: e.code, message: e.message };
  }
  if (e instanceof DomainError) {
    return {
      code: e.code,
      message: DOMAIN_ERROR_MESSAGES[e.code] ?? "処理に失敗しました",
    };
  }
  // 予期しないエラーは内容を隠す(個人情報・内部パスをUIに出さない)
  return { code: "INTERNAL", message: "サーバーエラーが発生しました" };
}

/** アクション本体を包み、例外を ActionResult に変換する。 */
export async function run<T>(
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
