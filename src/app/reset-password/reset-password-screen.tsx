"use client";

import { useState } from "react";
import Link from "next/link";
import { sendPasswordResetEmail } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  Alert,
  Button,
  Card,
  Field,
  issuesByField,
  TextInput,
} from "@/components/ui";
import { passwordResetSchema, parseForm } from "@/lib/validation/schemas";

function resetErrorMessage(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case "auth/invalid-email":
      case "auth/missing-email":
        return "メールアドレスの形式が正しくありません";
      case "auth/user-not-found":
        return "このメールアドレスのアカウントは見つかりません";
      case "auth/too-many-requests":
        return "試行回数が多すぎます。しばらく待ってから再試行してください";
      case "auth/network-request-failed":
        return "認証サーバーに接続できません。Emulatorの起動を確認してください";
    }
  }
  return "送信に失敗しました";
}

export function ResetPasswordScreen() {
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(passwordResetSchema, { email });
    if (!parsed.success) {
      setFieldErrors(issuesByField(parsed.issues));
      return;
    }
    setBusy(true);
    setError(undefined);
    setFieldErrors({});
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), parsed.data.email);
      setSent(true);
    } catch (err) {
      setError(resetErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-bold tracking-tight">
          パスワードのリセット
        </h1>
        {sent ? (
          <>
            <Alert tone="info" className="mt-4">
              <p>
                パスワードリセット用のメールを送信しました。
                メール内のリンクから新しいパスワードを設定してください。
              </p>
              <p className="mt-1 text-xs">
                メールが届かない場合は、迷惑メールフォルダを確認するか、
                時間をおいて再度お試しください。
              </p>
            </Alert>
            <p className="mt-4 text-center">
              <Link
                href="/login"
                className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                ログイン画面へ戻る
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-zinc-500">
              登録したメールアドレスを入力すると、
              パスワードリセット用のリンクを送信します。
            </p>
            <form
              onSubmit={submit}
              noValidate
              className="mt-4 flex flex-col gap-3"
            >
              <Field label="メールアドレス" error={fieldErrors.email}>
                <TextInput
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              {error && <Alert tone="error">{error}</Alert>}
              <Button type="submit" loading={busy}>
                リセットメールを送信
              </Button>
            </form>
            <p className="mt-3 text-center">
              <Link
                href="/login"
                className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                ログイン画面へ戻る
              </Link>
            </p>
          </>
        )}
      </Card>
    </main>
  );
}
