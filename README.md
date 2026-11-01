# Solo Accounting AI

個人事業主・小規模事業者向けの経理・決算準備・確定申告準備アプリ。

## Stack

- Next.js 16 (App Router / Turbopack) + React 19 + TypeScript
- Firebase Authentication / Cloud Firestore / Cloud Storage / Cloud Functions
- Firebase Emulator Suite(開発はEmulatorのみ。本番Firebaseへ接続しない)
- Vitest(単体テスト) / Playwright(E2E)
- Tailwind CSS 4

開発ルール・計画は [AGENTS.md](AGENTS.md)・[PLAN.md](PLAN.md)・[docs/](docs/) を参照。

## 前提

- **Node.js 26+**(`.node-version` 参照。engines: `^22.12.0 || ^24.0.0 || >=26.0.0`)
- **pnpm**(packageManager: pnpm@12。`corepack enable` で有効化)
- **JDK 21+**(Firestore/Storage Emulator・Rules テスト実行時のみ。
  firebase-tools 15系が要求。`JAVA_HOME` で指定可能)

## Setup

```bash
pnpm install
pnpm exec playwright install chromium   # E2E実行時のみ必要
```

### 環境変数

- 開発はコミット済みの `.env.development`(demo-* プロジェクト +
  Emulator接続)で動く。そのまま `pnpm dev` でOK。
- ローカルで上書きしたい値は `.env.local` に置く(git管理外)。
- 変数の一覧・意味は [.env.example](.env.example) を参照。
- 必須の `NEXT_PUBLIC_FIREBASE_*` が未設定だと起動時に
  `EnvValidationError` で明示的に失敗する(src/lib/env.ts)。
- 本番Firebaseの値を `.env*` に書かないこと(demo-* 以外の
  プロジェクトIDを使わない)。

### Emulator 起動

```bash
pnpm emulators        # Emulator Suite 起動(UI: http://localhost:4000)
pnpm dev              # NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true で自動接続
```

JDK 21+ が PATH の `java` で見つからない場合は `JAVA_HOME` を指定する。

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 pnpm emulators
```

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | 開発サーバー起動 |
| `pnpm build` / `pnpm start` | 本番ビルド / 起動 |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest(単体テスト) |
| `pnpm test:watch` | Vitest ウォッチモード |
| `pnpm test:rules` | Firestore/Storage Rules テスト(Emulator必須・JDK 21+) |
| `pnpm test:emulators` | Firestore Emulator 結合テスト(JDK 21+) |
| `pnpm test:e2e` | Playwright E2E。`emulators:exec` で Auth/Firestore/Storage Emulator を自動起動し、dev serverも自動起動(port 3000)。JDK 21+ 必須 |
| `pnpm emulators` | Firebase Emulator Suite 起動 |

## 本番 Firebase への切替

開発(Emulator)から本番プロジェクトへ切り替える手順:

1. デプロイ環境(ホスティングの環境変数設定や `.env.production` — いずれも
   git管理外)に本番値を設定する:
   - `NEXT_PUBLIC_FIREBASE_API_KEY` / `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` /
     `NEXT_PUBLIC_FIREBASE_PROJECT_ID` / `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` /
     `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` / `NEXT_PUBLIC_FIREBASE_APP_ID`
   - サーバーサイド(firebase-admin)用: `GOOGLE_CLOUD_PROJECT` +
     実行環境の認証情報(Workload Identity / ADC)。
     `GOOGLE_APPLICATION_CREDENTIALS` のJSONキーは発行しない方針を推奨
2. `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` を **削除または `true` 以外** にする
3. Emulator host を全て削除する:
   `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` /
   `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST` /
   `NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST` /
   `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` /
   `FIREBASE_STORAGE_EMULATOR_HOST`
   (残っていると起動時に警告が出る。Admin SDK はこれらがあると
   認証情報なしで Emulator へ接続してしまう)
4. Security Rules とインデックスを本番プロジェクトへ適用する:

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes,storage \
     --project <本番プロジェクトID>
   ```

   適用前に `pnpm test:rules` で Rules テストが通ることを確認する。

## デプロイ指針

- アプリ本体: `pnpm build`(`next build`)で本番ビルドし、Node.js 実行環境
  (Cloud Run / Firebase App Hosting 等)へデプロイする。Next.js の
  standalone/ランタイム要件はデプロイ先のドキュメントに従う。
- 環境変数はデプロイ先のシークレット/環境変数機能に設定する
  (本番値をリポジトリにコミットしない)。
- `OPENAI_API_KEY` 等のサーバーサイド専用キーは `NEXT_PUBLIC_` を
  付けず、サーバーの環境変数としてのみ設定する。
- Firestore/Storage の Security Rules・インデックスは上記の
  `firebase deploy` で別途適用する(アプリのデプロイとは分離)。
- デプロイ前チェック: `pnpm lint` / `pnpm exec next typegen && pnpm typecheck` /
  `pnpm test` / `pnpm build` / `pnpm test:rules`

## Testing Notes

- `pnpm typecheck` は `LayoutProps` 等のグローバル型に依存する。
  初回は `pnpm exec next typegen` で生成するか `pnpm dev` / `pnpm build`
  を一度実行してから行うこと(生成物は `.next/` 配下でgit管理外)。
- E2Eは `pnpm test:e2e`。`firebase emulators:exec` が auth/firestore/storage
  Emulator を起動し、Playwright が dev server を自動起動する(port 3000)。
  Emulator は実行ごとに初期化されるため、各テストは一意のメールアドレスで
  新規ユーザーを作成してデータを分離している(e2e/helpers.ts 参照)。
  実行には `JAVA_HOME=/opt/homebrew/opt/openjdk@21` 等の JDK 21+ が必要。
- Emulator・`next dev` の同時起動はポート衝突するため全 worktree 通して
  1系統まで(AGENTS.md)。

## Directory

```
src/app/            App Router のページ・レイアウト
src/lib/firebase/   Firebase 初期化(client.ts=ブラウザ用, admin.ts=サーバー用)
src/lib/env.ts      起動時の環境変数検証(必須env・Emulator残存警告)
src/lib/api/        Route Handler 共通(認可・エラー形式・レート制限)
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
