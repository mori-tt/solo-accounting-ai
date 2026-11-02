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

const NAV_ITEMS = [
  { href: "/dashboard", label: "ダッシュボード" },
  { href: "/transactions", label: "取引一覧" },
  { href: "/search", label: "検索" },
  { href: "/recurring", label: "定期取引" },
  { href: "/expenses/new", label: "経費登録" },
  { href: "/receipts", label: "領収書" },
  { href: "/customers", label: "顧客" },
  { href: "/projects", label: "案件" },
  { href: "/invoices", label: "請求・入金" },
  { href: "/reports/monthly", label: "月次レポート" },
  { href: "/reports/journal", label: "仕訳帳" },
  { href: "/reports/ledger", label: "総勘定元帳" },
  { href: "/reports/trial-balance", label: "試算表" },
  { href: "/reports/yearly", label: "年次レポート" },
  { href: "/reports/filing", label: "決算書(収支内訳書)" },
  { href: "/closing", label: "決算チェック" },
  { href: "/accounts", label: "勘定科目" },
  { href: "/allocations", label: "家事按分" },
  { href: "/opening-balances", label: "期首残高" },
  { href: "/fixed-assets", label: "固定資産" },
  { href: "/audit-log", label: "監査ログ" },
  { href: "/settings", label: "設定" },
  { href: "/backup", label: "バックアップ" },
] as const;

function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
      {NAV_ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

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
    await signOut();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-dvh flex-1">
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

        <main className="min-w-0 flex-1 px-6 py-6">
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

/** 認証ゲート。未ログインは /login へ。 */
export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed_out") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status !== "signed_in") {
    return (
      <div className="flex min-h-dvh flex-1 items-center justify-center">
        <LoadingBlock label="認証を確認しています..." />
      </div>
    );
  }
  return <ShellBody>{children}</ShellBody>;
}
