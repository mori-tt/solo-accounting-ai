"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { useApp } from "@/components/auth-provider";
import {
  Alert,
  Button,
  Card,
  Field,
  issuesByField,
  TextInput,
} from "@/components/ui";
import { loginSchema, parseForm } from "@/lib/validation/schemas";

function authErrorMessage(e: unknown): string {
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "メールアドレスまたはパスワードが違います";
      case "auth/email-already-in-use":
        return "このメールアドレスはすでに登録されています";
      case "auth/weak-password":
        return "パスワードは6文字以上にしてください";
      case "auth/invalid-email":
        return "メールアドレスの形式が正しくありません";
      case "auth/too-many-requests":
        return "試行回数が多すぎます。しばらく待ってから再試行してください";
      case "auth/network-request-failed":
        return "認証サーバーに接続できません。Emulatorの起動を確認してください";
    }
  }
  return "ログインに失敗しました";
}

export function LoginScreen() {
  const { status } = useApp();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "signed_in") router.replace("/dashboard");
  }, [status, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseForm(loginSchema, { email, password });
    if (!parsed.success) {
      setFieldErrors(issuesByField(parsed.issues));
      return;
    }
    setBusy(true);
    setError(undefined);
    setFieldErrors({});
    try {
      const auth = getFirebaseAuth();
      if (mode === "signin") {
        await signInWithEmailAndPassword(
          auth,
          parsed.data.email,
          parsed.data.password,
        );
      } else {
        await createUserWithEmailAndPassword(
          auth,
          parsed.data.email,
          parsed.data.password,
        );
      }
      // onIdTokenChanged がセッションCookieを同期し、status が signed_in になる
      router.replace("/dashboard");
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  if (status === "signed_in") {
    return null;
  }

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-bold tracking-tight">
          Solo Accounting AI
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          経理・決算準備・確定申告準備アプリ
        </p>

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-md bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
          {(
            [
              ["signin", "ログイン"],
              ["signup", "新規登録"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(undefined);
                setFieldErrors({});
              }}
              aria-pressed={mode === m}
              className={`rounded px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-indigo-500 ${
                mode === m
                  ? "bg-white font-medium shadow-sm dark:bg-zinc-900"
                  : "text-zinc-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

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
          <Field
            label="パスワード"
            hint="6文字以上"
            error={fieldErrors.password}
          >
            <TextInput
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {fieldErrors._form && (
            <Alert tone="error">{fieldErrors._form}</Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" loading={busy}>
            {mode === "signin" ? "ログイン" : "アカウントを作成"}
          </Button>
        </form>
        {mode === "signin" && (
          <p className="mt-3 text-center">
            <Link
              href="/reset-password"
              className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              パスワードを忘れた方はこちら
            </Link>
          </p>
        )}
      </Card>
    </main>
  );
}
