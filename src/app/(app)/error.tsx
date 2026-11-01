"use client";

import { Button, Card } from "@/components/ui";

export default function AppError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="mx-auto max-w-md py-16">
      <Card className="text-center">
        <h2 className="text-base font-semibold text-red-600">
          エラーが発生しました
        </h2>
        <p className="mt-2 text-sm text-zinc-500">
          {message || "予期しないエラーです"}
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => retry()}>
          再試行する
        </Button>
      </Card>
    </div>
  );
}
