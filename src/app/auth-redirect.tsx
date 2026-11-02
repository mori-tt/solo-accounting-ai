"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/auth-provider";

/**
 * ログイン済みユーザーが / を開いたらアプリへ戻す。
 * 未ログインにはランディングページをそのまま表示する。
 * (従来の / -> /dashboard リダイレクトの、ログイン済み側の挙動を保持)
 */
export function AuthRedirect() {
  const { status } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed_in") router.replace("/dashboard");
  }, [status, router]);

  return null;
}
