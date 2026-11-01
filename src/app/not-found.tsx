import Link from "next/link";

// 存在しないURL・notFound() 発生時の表示。
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium text-zinc-400">404</p>
      <h1 className="mt-2 text-lg font-semibold">ページが見つかりません</h1>
      <p className="mt-2 text-sm text-zinc-500">
        指定されたページは存在しないか、移動した可能性があります。
      </p>
      <Link
        href="/"
        className="mt-4 text-sm text-indigo-600 hover:underline"
      >
        トップへ戻る
      </Link>
    </div>
  );
}
