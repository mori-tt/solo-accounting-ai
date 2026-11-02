import Link from "next/link";

const LEGAL_LINKS = [
  { href: "/legal/terms", label: "利用規約" },
  { href: "/legal/privacy", label: "プライバシーポリシー" },
  { href: "/legal/tokusho", label: "特定商取引法に基づく表記" },
] as const;

/** 法務ページへのリンクフッター。ログイン画面・アプリ画面の末尾に設置する。 */
export function LegalFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <nav
        aria-label="法務情報"
        className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
      >
        {LEGAL_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-xs text-zinc-500 hover:text-indigo-600 hover:underline dark:text-zinc-400 dark:hover:text-indigo-400"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
