# Solo Accounting AI

個人事業主・小規模事業者向けの経理・決算準備・確定申告準備アプリ。

## Stack

- Next.js 16 (App Router / Turbopack) + React 19 + TypeScript
- Firebase Authentication / Cloud Firestore / Cloud Storage / Cloud Functions
- Firebase Emulator Suite(開発はEmulatorのみ。本番Firebaseへ接続しない)
- Vitest(単体テスト) / Playwright(E2E)
- Tailwind CSS 4

開発ルール・計画は [AGENTS.md](AGENTS.md)・[PLAN.md](PLAN.md)・[docs/](docs/) を参照。

## Setup

```bash
pnpm install
pnpm exec playwright install chromium   # E2E実行時のみ必要
```

環境変数は `.env.development` がコミット済みで、`demo-*` プロジェクト +
Emulator接続の設定になっている。そのまま `pnpm dev` で動く。
変数の一覧は [.env.example](.env.example) を参照。

本番Firebaseの値を `.env*` に書かないこと(demo-* 以外のプロジェクトIDを
使わない)。

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | 開発サーバー起動 |
| `pnpm build` / `pnpm start` | 本番ビルド / 起動 |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest(単体テスト) |
| `pnpm test:watch` | Vitest ウォッチモード |
| `pnpm test:e2e` | Playwright E2E。Auth/Firestore/Storage Emulator を `emulators:exec` で自動起動し、dev serverも自動起動(port 3000)。JDK 21+ 必須 |
| `pnpm emulators` | Firebase Emulator Suite 起動(UI: http://localhost:4000) |

Firestore/Storage の Emulator には **JDK 21以上** が必要(firebase-tools 15系)。
PATH上の `java` が21未満の場合は `JAVA_HOME` を指定して起動する。

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 pnpm emulators
```

Emulator起動中に `pnpm dev` を使うと、アプリは自動でEmulatorに接続する
(`NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`)。

## Testing Notes

- `pnpm typecheck` は `LayoutProps` 等のグローバル型に依存する。
  初回は `pnpm exec next typegen` で生成するか `pnpm dev` / `pnpm build`
  を一度実行してから行うこと(生成物は `.next/` 配下でgit管理外)。
- E2Eは `pnpm test:e2e`。`firebase emulators:exec` が auth/firestore/storage
  Emulator を起動し、Playwright が dev server を自動起動する(port 3000)。
  Emulator は実行ごとに初期化されるため、各テストは一意のメールアドレスで
  新規ユーザーを作成してデータを分離している(e2e/helpers.ts 参照)。
  実行には `JAVA_HOME=/opt/homebrew/opt/openjdk@21` 等の JDK 21+ が必要。

## Directory

```
src/app/            App Router のページ・レイアウト
src/lib/firebase/   Firebase 初期化(client.ts=ブラウザ用, admin.ts=サーバー用)
e2e/                Playwright テスト
docs/               要件・スキーマ・会計・セキュリティ・AI方針・ADR
firebase.json       Emulator/ルール設定( ports: auth 9099, firestore 8080, storage 9199 )
firestore.rules     Firestore Security Rules(骨格・全拒否。docs/SECURITY_RULES.md を参照)
storage.rules       Storage Security Rules(骨格・全拒否)
```

## Development Flow

- mainへ直接変更しない。1タスク1Worktree
- 作業内容は [REVIEW.md](REVIEW.md) に記録する
- Required Checks: `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` / Firebase Emulator tests
