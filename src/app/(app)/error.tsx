"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, Card } from "@/components/ui";

// digest は本番でサーバーログと対応付けるための識別子(内容は含まない)
function errorDigest(error: unknown): string | undefined {
  return error instanceof Error && "digest" in error
    ? String(error.digest)
    : undefined;
}

export default function AppError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // クライアント側の診断用。個人情報・証憑内容はログに出さない
    // (本番でサーバー由来のエラーは汎用メッセージ+digestに置き換わる)
    console.error(error);
  }, [error]);

  const message = error instanceof Error ? error.message : String(error);
  const digest = errorDigest(error);
  return (
    <div className="mx-auto max-w-md py-16">
      <Card className="text-center">
        <h2 className="text-base font-semibold text-red-600">
          エラーが発生しました
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          {message || "予期しないエラーです"}
        </p>
        {digest && (
          <p className="mt-1 text-xs text-zinc-400">エラーID: {digest}</p>
        )}
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button variant="secondary" onClick={() => retry()}>
            再試行する
          </Button>
          <Link
            href="/dashboard"
            className="text-sm text-indigo-600 hover:underline"
          >
            ダッシュボードへ戻る
          </Link>
        </div>
      </Card>
    </div>
  );
}
