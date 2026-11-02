"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, Card } from "@/components/ui";
import { captureException } from "@/lib/monitoring";

// ルートセグメント(login・(app)グループ外を含む)のエラー境界。
// ルートレイアウト自体のエラーは global-error.tsx が拾う。
export default function RootError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest =
    error instanceof Error && "digest" in error
      ? String(error.digest)
      : undefined;

  useEffect(() => {
    // 監視へ送信(構造化ログへフォールバック)。digestはサーバーログとの
    // 対応付け用の識別子で個人情報を含まない。証憑内容等は送らない
    captureException(error, {
      tags: { boundary: "root-error" },
      extra: { digest },
    });
  }, [error, digest]);
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center">
      <Card className="w-full text-center">
        <h2 className="text-base font-semibold text-red-600">
          エラーが発生しました
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          予期しないエラーが発生しました。時間をおいて再試行してください。
        </p>
        {digest && (
          <p className="mt-1 text-xs text-zinc-400">エラーID: {digest}</p>
        )}
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button variant="secondary" onClick={() => retry()}>
            再試行する
          </Button>
          <Link href="/" className="text-sm text-indigo-600 hover:underline">
            トップへ戻る
          </Link>
        </div>
      </Card>
    </div>
  );
}
