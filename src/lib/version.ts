import packageJson from "../../package.json";

/**
 * アプリのバージョン。package.json の version を正として一元化する。
 * フッター等での表示はこの値を使うこと(package.json を直接 import しない)。
 */
export const APP_VERSION: string = packageJson.version;
