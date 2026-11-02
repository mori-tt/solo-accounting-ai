"use client";

import { useEffect, useRef, useState } from "react";
import { sendEmailVerification } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { useApp } from "./auth-provider";
import { Button } from "./ui";

/** 再送ボタンの連打防止クールダウン */
const RESEND_COOLDOWN_MS = 60_000;
/** タブ復帰時の確認状態チェックの最短間隔 */
const REFRESH_THROTTLE_MS = 15_000;

function resendErrorMessage(e: unknown): string {
  if (e instanceof FirebaseError && e.code === "auth/too-many-requests") {
    return "確認メールの送信回数が多すぎます。しばらく待ってから再試行してください";
  }
  return "確認メールの送信に失敗しました";
}

/**
 * メールアドレス未確認のユーザーへ確認を促すバナー。
 * (app) レイアウト上部に常駐し、確認が済むまで表示し続ける
 * (機能ブロックはせず案内のみ)。
 *
 * 確認済みの反映: Firebase は emailVerified の変更を push しないため、
 * マウント時・タブ復帰時に user.reload() で最新化する。
 * user オブジェクトは reload で同一参照のまま更新されるので、
 * context 経由では再描画されず、ローカル state(verified)でも判定する。
 */
export function EmailVerifyBanner() {
  const { user, status } = useApp();
  const [verified, setVerified] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resendBlocked, setResendBlocked] = useState(false);
  const lastCheckRef = useRef(0);

  // 再送クールダウン
  useEffect(() => {
    if (!resendBlocked) return;
    const t = setTimeout(() => setResendBlocked(false), RESEND_COOLDOWN_MS);
    return () => clearTimeout(t);
  }, [resendBlocked]);

  // マウント時とタブ復帰時に確認状態を最新化(メールアプリ等で
  // 確認リンクを開いて戻ってきたケースを拾う)
  useEffect(() => {
    if (!user || user.emailVerified) return;
    const check = () => {
      const now = Date.now();
      if (now - lastCheckRef.current < REFRESH_THROTTLE_MS) return;
      lastCheckRef.current = now;
      void user
        .reload()
        .then(() => {
          if (user.emailVerified) setVerified(true);
        })
        .catch(() => undefined);
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user]);

  if (status !== "signed_in" || !user || user.emailVerified || verified) {
    return null;
  }

  const resend = async () => {
    setSending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await sendEmailVerification(user);
      setNotice(
        "確認メールを再送しました。届かない場合は迷惑メールフォルダも確認してください",
      );
      setResendBlocked(true);
    } catch (e) {
      setError(resendErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const refresh = async () => {
    setChecking(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await user.reload();
      if (user.emailVerified) {
        // IDトークン(email_verified claim)も更新して
        // onIdTokenChanged 経由でセッションCookieを再同期する
        await user.getIdToken(true);
        setVerified(true);
      } else {
        setNotice("まだ確認が完了していません。メール内のリンクを開いてください");
      }
    } catch {
      setError("確認状態の更新に失敗しました");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1">
          メールアドレスが未確認です。
          届いている確認メールのリンクを開いてください。
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            onClick={refresh}
            loading={checking}
            disabled={sending}
          >
            確認を反映
          </Button>
          <Button
            variant="secondary"
            onClick={resend}
            loading={sending}
            disabled={resendBlocked}
          >
            確認メールを再送
          </Button>
        </div>
      </div>
      {(notice || error) && (
        <p
          className={`mx-auto mt-1.5 max-w-5xl text-xs ${
            error
              ? "text-red-600 dark:text-red-400"
              : "text-amber-800 dark:text-amber-300"
          }`}
          role={error ? "alert" : undefined}
        >
          {error ?? notice}
        </p>
      )}
    </div>
  );
}
