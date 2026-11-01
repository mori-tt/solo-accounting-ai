/**
 * 起動時の環境変数検証。
 * Firebaseクライアント初期化(src/lib/firebase/client.ts)から呼び、
 * 必須の NEXT_PUBLIC_FIREBASE_* が未設定のまま動作しないよう
 * 早期に明示的なエラーにする(空文字のまま initializeApp すると
 * SDK内部の分かりにくいエラーになるため)。
 * 変数の一覧・意味は .env.example と対応させること。
 */

export type EnvVars = Record<string, string | undefined>;

/** Firebaseクライアント設定の必須キー(.env.example と対応) */
export const REQUIRED_FIREBASE_CLIENT_ENV = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

/**
 * Emulator接続先の環境変数。
 * 本番(Emulator不使用)の環境に残っていると、Admin SDKが認証情報なしで
 * Emulatorへ接続する等の事故につながるため警告対象にする。
 */
export const EMULATOR_HOST_ENV = [
  "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST",
  "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST",
  "NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_STORAGE_EMULATOR_HOST",
] as const;

/** 環境変数の設定不備。メッセージに不足キー名を列挙する */
export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvValidationError";
  }
}

/** 未設定(または空・空白のみ)の必須 NEXT_PUBLIC_FIREBASE_* を返す */
export function missingFirebaseClientEnv(env: EnvVars = process.env): string[] {
  return REQUIRED_FIREBASE_CLIENT_ENV.filter((key) => !env[key]?.trim());
}

export function usesEmulator(env: EnvVars = process.env): boolean {
  return env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
}

/** Emulator使用フラグが無いのに残っている Emulator host 環境変数を返す */
export function leftoverEmulatorHostEnv(env: EnvVars = process.env): string[] {
  if (usesEmulator(env)) return [];
  return EMULATOR_HOST_ENV.filter((key) => !!env[key]?.trim());
}

/** 必須の NEXT_PUBLIC_FIREBASE_* が空なら EnvValidationError を投げる */
export function validateFirebaseClientEnv(env: EnvVars = process.env): void {
  const missing = missingFirebaseClientEnv(env);
  if (missing.length > 0) {
    throw new EnvValidationError(
      `Firebaseクライアント設定が不足しています: ${missing.join(", ")}。` +
        ".env.example を参照して環境変数を設定してください",
    );
  }
}

/**
 * 本番(NEXT_PUBLIC_USE_FIREBASE_EMULATOR!=true)で Emulator host が
 * 残っていたら警告する。実害を避けるため起動は継続する(警告のみ)。
 */
export function warnIfProductionWithEmulatorHost(
  env: EnvVars = process.env,
  warn: (message: string) => void = (m) => console.warn(m),
): void {
  const leftover = leftoverEmulatorHostEnv(env);
  if (leftover.length > 0) {
    warn(
      `[env] Emulator不使用の設定ですが Emulator 接続先が残っています: ` +
        `${leftover.join(", ")}。本番環境では削除してください`,
    );
  }
}

let validated = false;

/**
 * Firebaseクライアント初期化時に1回だけ検証する
 * (警告の重複出力と毎回の検査コストを避ける)。
 * 検証エラー時はメモ化しない(呼び出しごとに失敗し続ける=fail fast)。
 */
export function assertFirebaseClientEnvOnce(): void {
  if (validated) return;
  validateFirebaseClientEnv();
  warnIfProductionWithEmulatorHost();
  validated = true;
}

/** テスト用: メモ化状態をリセットする */
export function resetEnvValidationForTest(): void {
  validated = false;
}
