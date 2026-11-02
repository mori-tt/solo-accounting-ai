"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "./auth-provider";
import {
  Alert,
  Button,
  Card,
  Field,
  formIssuesMessage,
  LoadingBlock,
  NumberInput,
  Select,
  Spinner,
  TextInput,
} from "./ui";
import { createBusiness } from "@/lib/actions/businesses";
import { businessSchema, parseForm } from "@/lib/validation/schemas";
import { NavLinks } from "./nav-links";

/** 初回: 事業が無いユーザーに最初の事業作成を促す */
function BusinessOnboarding() {
  const { reloadBusinesses } = useApp();
  const [name, setName] = useState("");
  const [startMonth, setStartMonth] = useState("1");
  const [taxMode, setTaxMode] = useState<"exempt" | "simple" | "standard">(
    "exempt",
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      name,
      fiscalYearStartMonth: Number(startMonth),
      taxMode,
    };
    const parsed = parseForm(businessSchema, input);
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setBusy(true);
    setError(undefined);
    const res = await createBusiness({
      ...parsed.data,
      idempotencyKey: crypto.randomUUID(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    reloadBusinesses();
  };

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <h2 className="text-lg font-semibold">事業を作成しましょう</h2>
        <p className="mt-1 text-sm text-zinc-500">
          経理データは事業(Business)ごとに管理されます。
        </p>
        <form
          onSubmit={submit}
          noValidate
          className="mt-4 flex flex-col gap-3"
        >
          <Field label="事業名">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 山田太郎(個人事業)"
              required
            />
          </Field>
          <Field label="会計年度の開始月" hint="個人事業主は通常1月(暦年)">
            <NumberInput
              value={startMonth}
              min={1}
              max={12}
              onChange={(e) => setStartMonth(e.target.value)}
              required
            />
          </Field>
          <Field label="消費税の課税方式">
            <Select
              value={taxMode}
              onChange={(e) =>
                setTaxMode(e.target.value as typeof taxMode)
              }
            >
              <option value="exempt">免税事業者</option>
              <option value="simple">簡易課税</option>
              <option value="standard">本則課税</option>
            </Select>
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" loading={busy}>
            事業を作成する
          </Button>
        </form>
      </Card>
    </div>
  );
}

function ShellBody({ children }: { children: ReactNode }) {
  const {
    user,
    businesses,
    businessesLoading,
    businessId,
    business,
    selectBusiness,
    signOut,
  } = useApp();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-1">
      {/* キーボード/SRユーザーがナビを飛ばして本文へ移動するためのスキップリンク */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        本文へスキップ
      </a>
      <aside className="flex w-52 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="px-5 pt-5">
          <Link href="/dashboard" className="text-sm font-bold tracking-tight">
            Solo Accounting AI
          </Link>
        </div>
        <Suspense fallback={null}>
          <NavLinks />
        </Suspense>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400">事業</span>
            {businessesLoading ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <Select
                className="w-56"
                value={businessId ?? ""}
                onChange={(e) => selectBusiness(e.target.value)}
                aria-label="事業の切り替え"
              >
                {businesses.length === 0 && <option value="">未作成</option>}
                {businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
            {business && (
              <span className="text-xs text-zinc-400">
                年度開始月 {business.fiscalYearStartMonth}月
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="max-w-48 truncate text-xs text-zinc-500">
              {user?.email}
            </span>
            <Button variant="ghost" onClick={onSignOut} loading={signingOut}>
              ログアウト
            </Button>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-6 py-6 focus:outline-none"
        >
          {businessesLoading ? (
            <LoadingBlock />
          ) : businesses.length === 0 ? (
            <BusinessOnboarding />
          ) : businessId === null ? (
            <LoadingBlock />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

/** 認証ゲート。未ログインは /login へ(行き先を next パラメータで保持)。 */
export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useApp();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "signed_out") {
      // デフォルトの遷移先(ダッシュボード)は next を付けずURLを簡潔に保つ
      const query =
        pathname && pathname !== "/dashboard"
          ? `?next=${encodeURIComponent(pathname)}`
          : "";
      router.replace(`/login${query}`);
    }
  }, [status, router, pathname]);

  if (status !== "signed_in") {
    return (
      <div className="flex min-h-dvh flex-1 items-center justify-center">
        <LoadingBlock label="認証を確認しています..." />
      </div>
    );
  }
  return <ShellBody>{children}</ShellBody>;
}
