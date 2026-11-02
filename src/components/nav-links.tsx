"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * サイドバーのナビゲーション。項目数が多いため用途単位でグルーピングし、
 * セクション見出しを付ける。各グループ内の並びは利用頻度・業務フロー順。
 */
const NAV_GROUPS = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "ダッシュボード" }],
  },
  {
    label: "記帳",
    items: [
      { href: "/transactions", label: "取引一覧" },
      { href: "/search", label: "検索" },
      { href: "/recurring", label: "定期取引" },
      { href: "/expenses/new", label: "経費登録" },
      { href: "/receipts", label: "領収書" },
    ],
  },
  {
    label: "売上・請求",
    items: [
      { href: "/customers", label: "顧客" },
      { href: "/projects", label: "案件" },
      { href: "/invoices", label: "請求・入金" },
    ],
  },
  {
    label: "レポート",
    items: [
      { href: "/reports/monthly", label: "月次レポート" },
      { href: "/reports/journal", label: "仕訳帳" },
      { href: "/reports/ledger", label: "総勘定元帳" },
      { href: "/reports/trial-balance", label: "試算表" },
      { href: "/reports/yearly", label: "年次レポート" },
      { href: "/reports/filing", label: "決算書(収支内訳書)" },
    ],
  },
  {
    label: "決算・管理",
    items: [
      { href: "/closing", label: "決算チェック" },
      { href: "/accounts", label: "勘定科目" },
      { href: "/allocations", label: "家事按分" },
      { href: "/opening-balances", label: "期首残高" },
      { href: "/fixed-assets", label: "固定資産" },
      { href: "/inventory", label: "棚卸・在庫" },
      { href: "/audit-log", label: "監査ログ" },
      { href: "/settings", label: "設定" },
      { href: "/backup", label: "バックアップ" },
      { href: "/business-delete", label: "事業の削除" },
    ],
  },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label ?? "home"}>
          {group.label !== null && (
            <h2 className="mt-4 px-3 pb-1 text-[11px] font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
              {group.label}
            </h2>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
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
          </div>
        </div>
      ))}
    </nav>
  );
}
