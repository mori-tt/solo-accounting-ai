"use client";

import { use } from "react";
import { browser } from "react-dom";

/**
 * このコンポーネント以下をブラウザ専用描画にする。
 * プリレンダリング時は最も近い <Suspense> のフォールバックが出力される。
 * Firebase SDK・localStorage・new Date() などをレンダー中に使う画面で呼ぶ。
 */
export function useBrowserOnly(): void {
  use(browser("この画面はブラウザでのみ描画されます"));
}
