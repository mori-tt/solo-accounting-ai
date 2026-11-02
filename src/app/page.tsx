import type { Metadata } from "next";
import Link from "next/link";
import { APP_VERSION } from "@/lib/version";
import { AuthRedirect } from "./auth-redirect";

export const metadata: Metadata = {
  title: {
    absolute:
      "Solo Accounting AI | 個人事業主の経理・決算準備・確定申告準備アプリ",
  },
  alternates: { canonical: "/" },
};

const FEATURES = [
  {
    title: "取引・経費の記帳",
    description:
      "勘定科目つきで取引と経費を登録。銀行CSVの取り込みで手入力の手間を減らします。",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.75v10.5m-4.5-8.25h6.75a2.25 2.25 0 010 4.5h-4.5a2.25 2.25 0 000 4.5H17M4.5 4.5h15v15h-15z"
      />
    ),
  },
  {
    title: "AI仕訳・科目の提案",
    description:
      "AIが勘定科目や重複取引の候補を提案します。確定はあなたの承認が必要です。",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 3.75l1.2 3.3a1.5 1.5 0 00.95.95l3.3 1.2-3.3 1.2a1.5 1.5 0 00-.95.95l-1.2 3.3-1.2-3.3a1.5 1.5 0 00-.95-.95l-3.3-1.2 3.3-1.2a1.5 1.5 0 00.95-.95l1.2-3.3zm9 8.25l.7 1.95a1 1 0 00.6.6l1.95.7-1.95.7a1 1 0 00-.6.6l-.7 1.95-.7-1.95a1 1 0 00-.6-.6l-1.95-.7 1.95-.7a1 1 0 00.6-.6l.7-1.95z"
      />
    ),
  },
  {
    title: "証憑の一元管理",
    description:
      "領収書・請求書をアップロードして取引に紐付け。AIが金額・日付・取引先の抽出を手伝います。",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-8.25a2.25 2.25 0 00-2.25-2.25h-10.5A2.25 2.25 0 004.5 6v12a2.25 2.25 0 002.25 2.25h4.5M15.75 18l2.25 2.25 4.5-4.5M9 8.25h6M9 11.25h6"
      />
    ),
  },
  {
    title: "売上・請求・入金消込",
    description:
      "顧客・案件ごとに請求書を作成し、入金を消込。未入金の請求もすぐ見つかります。",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 8.25h19.5M4.5 8.25V18a2.25 2.25 0 002.25 2.25h10.5A2.25 2.25 0 0019.5 18V8.25M7.5 8.25V6a2.25 2.25 0 012.25-2.25h4.5A2.25 2.25 0 0116.5 6v2.25M12 12v3.75"
      />
    ),
  },
  {
    title: "締め処理と決算準備",
    description:
      "月次締めのチェックリスト、収支内訳書・決算書レポートで確定申告の準備を進められます。",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75l2.25 2.25L15.75 10.5M12 21a9 9 0 100-18 9 9 0 000 18z"
      />
    ),
  },
  {
    title: "家事按分・固定資産",
    description:
      "家事按分ルールや減価償却の固定資産管理まで、個人事業の実務に対応します。",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 10.5l9-7.5 9 7.5M5.25 9.75V18a2.25 2.25 0 002.25 2.25h9A2.25 2.25 0 0018.75 18V9.75M9.75 20.25v-6h4.5v6"
      />
    ),
  },
] as const;

const TRUST_POINTS = [
  {
    title: "AIは「提案」まで",
    description:
      "AIが仕訳を自動確定することはありません。提案は必ずあなたが確認・承認してから帳簿に反映されます。",
  },
  {
    title: "事業ごとにデータを分離",
    description:
      "経理データは事業(Business)単位で厳格に分離。変更履歴は監査ログに記録されます。",
  },
  {
    title: "締め済み期間は変更不可",
    description:
      "締めた期間のデータは直接変更できない設計。帳簿の整合性と証跡を守ります。",
  },
] as const;

const STEPS = [
  {
    title: "アカウントを作成",
    description: "メールアドレスとパスワードだけで始められます。",
  },
  {
    title: "事業を登録",
    description: "事業名と会計年度の開始月、消費税の課税方式を設定。",
  },
  {
    title: "記帳をはじめる",
    description: "取引を登録すれば、レポートと締めチェックが使えます。",
  },
] as const;

const LEGAL_LINKS = [
  { href: "/legal/terms", label: "利用規約" },
  { href: "/legal/privacy", label: "プライバシーポリシー" },
  { href: "/legal/tokusho", label: "特定商取引法に基づく表記" },
] as const;

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Solo Accounting AI"
    >
      <rect width="64" height="64" rx="14" fill="#4f46e5" />
      <rect x="14" y="34" width="8" height="16" rx="2" fill="#fff" />
      <rect x="28" y="26" width="8" height="24" rx="2" fill="#fff" />
      <rect x="42" y="18" width="8" height="32" rx="2" fill="#fff" />
    </svg>
  );
}

function FeatureIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="h-6 w-6"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ログイン済みなら /dashboard へ戻す(未ログインはLPを表示) */}
      <AuthRedirect />

      <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-white/80 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <LogoMark className="h-6 w-6" />
            <span className="text-sm font-bold tracking-tight">
              Solo Accounting AI
            </span>
          </div>
          <nav className="flex items-center gap-1 sm:gap-4">
            <a
              href="#features"
              className="hidden rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 sm:inline-block dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              機能
            </a>
            <a
              href="#trust"
              className="hidden rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 sm:inline-block dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              安心設計
            </a>
            <Link
              href="/login"
              className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              ログイン
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* ヒーロー */}
        <section className="border-b border-zinc-200/70 dark:border-zinc-800/70">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300">
                個人事業主・小規模事業者向け
              </p>
              <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                経理から確定申告の準備まで、
                <br className="hidden sm:block" />
                これひとつ。
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-600 dark:text-zinc-300">
                Solo Accounting AI
                は、ひとり事業のための経理アプリです。経費・売上・証憑・請求を一元管理し、月次の締めから決算書(収支内訳書)づくり、確定申告の準備まで支援します。
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/login"
                  className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
                >
                  無料ではじめる
                </Link>
                <a
                  href="#features"
                  className="rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  機能を見る
                </a>
              </div>
              <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                アカウント作成はメールアドレスとパスワードだけ。ブラウザですぐに使えます。
              </p>
            </div>

            {/* 画面イメージ(CSSモック) */}
            <div
              className="relative mx-auto w-full max-w-md"
              aria-hidden="true"
            >
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-zinc-500">
                    月次サマリ 2026年10月
                  </p>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    締めチェック OK
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    ["売上", "¥1,240,000", "text-zinc-900 dark:text-zinc-50"],
                    ["経費", "¥386,500", "text-zinc-900 dark:text-zinc-50"],
                    ["利益", "¥853,500", "text-indigo-600 dark:text-indigo-400"],
                  ].map(([label, value, color]) => (
                    <div
                      key={label}
                      className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60"
                    >
                      <p className="text-[10px] text-zinc-500">{label}</p>
                      <p className={`mt-1 text-sm font-semibold ${color}`}>
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex h-24 items-end gap-2">
                  {[40, 65, 30, 80, 55, 95, 70].map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm bg-indigo-500/80"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
                <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/40">
                  <p className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                    AI提案: 「AWS利用料 ¥12,800」→ 通信費
                  </p>
                  <div className="mt-2 flex gap-2">
                    <span className="rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-medium text-white">
                      承認する
                    </span>
                    <span className="rounded border border-zinc-300 px-2 py-0.5 text-[10px] text-zinc-500 dark:border-zinc-600">
                      却下
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 機能紹介 */}
        <section id="features" className="scroll-mt-14">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              ひとり事業に必要な機能を、まとめて
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              記帳・証憑・請求・締め・レポートまで、経理の流れをそのままカバーします。
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                    <FeatureIcon>{f.icon}</FeatureIcon>
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {f.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 安心設計 */}
        <section
          id="trust"
          className="scroll-mt-14 border-y border-zinc-200/70 bg-zinc-50 dark:border-zinc-800/70 dark:bg-zinc-900/40"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              帳簿だから、安心設計にこだわる
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {TRUST_POINTS.map((t) => (
                <div
                  key={t.title}
                  className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <h3 className="text-base font-semibold text-indigo-700 dark:text-indigo-300">
                    {t.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {t.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 使い方 */}
        <section id="how">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              3ステップではじめられる
            </h2>
            <ol className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                    {i + 1}
                  </div>
                  <h3 className="mt-3 text-base font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {s.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-zinc-200/70 dark:border-zinc-800/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              さあ、経理を片づけよう。
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
              確定申告の直前に慌てないために。今日から記帳をはじめましょう。
            </p>
            <Link
              href="/login"
              className="mt-8 inline-block rounded-md bg-indigo-600 px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
            >
              無料ではじめる
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200/70 bg-zinc-50 dark:border-zinc-800/70 dark:bg-zinc-900/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <LogoMark className="h-5 w-5" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              &copy; 2026 Solo Accounting AI
            </span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              v{APP_VERSION}
            </span>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
