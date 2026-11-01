"use client";

import Link from "next/link";
import { signOut } from "@/lib/firebase/auth";
import { useAuth } from "@/lib/firebase/auth-provider";

export function AuthStatus() {
  const { user, loading } = useAuth();

  if (loading) {
    return <p className="text-sm text-zinc-400">認証状態を確認中...</p>;
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        ログイン
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">
        {user.displayName || user.email}
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        ログアウト
      </button>
    </div>
  );
}
