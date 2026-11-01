"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiDataState<T> {
  data: T | undefined;
  loading: boolean;
  /** 初回ロード中のみ true */
  initialLoading: boolean;
  error: string | undefined;
  errorCode: string | undefined;
  reload: () => void;
}

/**
 * Server Action の読み取りを状態管理する共通フック。
 * ローディング / エラー / 空データの3状態を全画面で統一する。
 * deps が変わると再取得する。loader は callApi 等でデータそのものを
 * resolve する Promise を返すこと(失敗は throw でエラー状態になる)。
 */
export function useApiData<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
): ApiDataState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string }>();
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);

  // 最新のloaderをrefへ同期(取得effectの前に実行される)
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let cancelled = false;
    // effect本体内での同期的setStateを避けつつ、fetch解決前に
    // loading=true にするため microtask で先行実行する
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(undefined);
    });
    loaderRef
      .current()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError({
            code:
              e && typeof e === "object" && "code" in e
                ? String((e as { code: unknown }).code)
                : "INTERNAL",
            message: e instanceof Error ? e.message : "読み込みに失敗しました",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    data,
    loading,
    initialLoading: loading && data === undefined,
    error: error?.message,
    errorCode: error?.code,
    reload,
  };
}
