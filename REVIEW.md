# REVIEW.md

作業内容の記録。各タスク完了時に追記する。

## 記録フォーマット

```
## YYYY-MM-DD: タスク名

- Worktree: <worktree名>
- 変更内容: <概要>
- 変更ファイル: <主要なファイル>
- Checks: lint / typecheck / test / build / emulator の結果
- 備考: <判断事項・懸念点など>
```

## Log

## 2026-10-31: 経理ドメインの実装

- Worktree: accounting-domain(ブランチ `mori-tt/accounting-domain`)

### 実装内容

`src/lib/accounting/` にFirestore非依存のドメイン層 + 永続化ポートを実装。UI・API層には会計ロジックを置かない設計。

- **基盤**: `types.ts`(スキーマ準拠のエンティティ)、`errors.ts`(DomainError+コード)、`money.ts`(円整数バリデーション)、`dates.ts`(YYYY-MM-DD・月末・うるう年・会計年度/期間計算)、`audit.ts`、`suggestions.ts`(AI提案モデル・適用ロジック)
- **Store**: `store/types.ts` の `AccountingReader`/`AccountingStore` ポート。`transact` は「トランザクション内読み取り + batch(puts+audits)の不可分適用」。`idempotencyKey` を指定すると記録を作成し、再実行は保存済み結果を replayed=true で返す
- **実装**: `store/memory.ts`(テスト用)、`store/firestore.ts`(Admin SDK。`*At`フィールドをISO↔Timestamp変換、冪等キーはSHA-256 doc ID)
- **サービス**: 事業体登録、取引登録/確定、経費登録/支払記録/未払検出、顧客・案件・請求書(明細から合計再計算)/発行/入金消込/過入金防止/overdue更新/未入金検出、証憑登録/紐付/アーカイブ、AI提案の記録・採用・拒否、月次集計(純粋関数+再計算)、会計期間の自動作成(`fy{year}`で冪等)/決算チェックリスト/期次締め

### 主要な設計判断

- **0円・負額は登録時に拒否**。訂正は正の金額の取消し仕訳で表現(ACCOUNTING_RULES方針)。税額・単価などは `assertNonNegativeYen` で0を許容
- **締め済み期間の保護は日付ベース**: status=locked判定に加え、変更対象の日付(取引日・支払日・入金日・提案適用日)が closed 期間に入る操作はすべて PERIOD_CLOSED で拒否
- **期次締め**: 期間内にdraftが1件でもあれば HAS_DRAFT_TRANSACTIONS で拒否。成功時は期間内の confirmed をすべて locked にし close の監査ログを記録
- **AI**: 提案は `aiSuggestion` のみに保持。採用=許可フィールド(account/amount/date/counterparty/description/type)を確定値へコピーするが status は draft のまま。confirmed は `confirmTransaction` のみ。拒否は確定値を一切変更しない。呼び出し記録は `ai_suggest`/`approve_ai`/`reject_ai` として auditLogs に記録
- **月次集計**: draft は除外(confirmed+lockedのみ)。monthlySummaries は常にTransactionから再計算して上書き
- **監査ログ**: puts対象ごとに識別情報のみ記録(内容スナップショットなし)

### 実行したテスト

- `pnpm lint` — 合格
- `pnpm typecheck` — 合格(`pnpm exec next typegen` 実行後)
- `pnpm test` — 合格(10ファイル93件、emulatorテスト4件はskip)
- `pnpm build` — 合格(下記「未解決事項」のworktree対応が必要)
- `JAVA_HOME=/opt/homebrew/opt/openjdk@21 pnpm test:emulators` — 合格(Firestore Emulator経由4件:往復・冪等リプレイ・監査・日付範囲クエリ)
- カバレッジ: 0円/負額/小数、不正日付・2/30・うるう年、月末・年度境界(暦年/4月/12月始まり)、二重登録(冪等リプレイ)、未入金・超過入金・全額消込、未払・overdue検出、締め済み期間の全操作拒否、AI提案の採用/拒否/draft維持

### 変更ファイル

- 新規: `src/lib/accounting/**`(ドメイン層一式)、`tests/emulator/firestoreStore.test.ts`
- 更新: `package.json`(`test:emulators`スクリプト)、`docs/FIRESTORE_SCHEMA.md`(idempotencyKeys、監査action追加、fiscalPeriods補足)

### 未解決事項

- **worktreeの共有ディレクトリ問題**: orcaの `sharedDirectories` により `node_modules`/`.next` は本体へのシンボリックリンクだが、Turbopackはworkspace root外実体を参照するシンボリックリンク経由のnext解決を拒否し `pnpm build` が失敗する。このworktreeでは `rm node_modules .next` 後に `pnpm install` してローカル実体に切替済み(本体・他worktreeには影響なし、git管理外)。他worktreeでも同様の対応が必要
- **Security Rulesは依然として全拒否の骨格**。rules実装 + @firebase/rules-unit-testing導入は別タスク。本ドメイン層はサーバーサイド(Admin SDK)経由なのでrules非依存だが、クライアント直アクセスは現状一切できない
- `emulators:exec` 初回実行時にポート競合で失敗することがある(再実行で解消)。グローバル版firebase-toolsはNode 26で起動自体に失敗するため `node_modules/.bin` の15系を使うこと
- invoice/customer/project の更新・削除、transaction編集/削除(補正仕訳フロー)、Cloud Functions/Server Actionの接続は未着手
- `seedClosedPeriod`(testing.ts)はcloseを通さず直接closed期間を作るテスト専用補助

### 次の担当者への注意事項

- サービス呼び出しは必ず `AccountingStore` ポート経由。新しいコマンドは `transact` 内で読み取り→batch返却の形にし、変更対象日付の `assertDateInOpenPeriod`/`assertTransactionEditable` を忘れない
- `idempotencyKey` は冪等性が必要なコマンドで必須パラメータ。リプレイ時は保存済みvalueがそのまま返るため、返り値はJSON化可能な形にすること
- `pnpm test` だけではemulatorテストはskipされる。`pnpm test:emulators` は `JAVA_HOME=/opt/homebrew/opt/openjdk@21` を付けること

## 2026-10-31: ルート管理ファイルの作成

- Worktree: foundation
- 変更内容: AGENTS.md, PLAN.md, REVIEW.md, docs/ 配下の管理ドキュメントを初期作成
- 変更ファイル: AGENTS.md, PLAN.md, REVIEW.md, docs/REQUIREMENTS.md, docs/FIRESTORE_SCHEMA.md, docs/ACCOUNTING_RULES.md, docs/SECURITY_RULES.md, docs/AI_POLICY.md, docs/DECISIONS.md
- Checks: 未実施(ドキュメントのみ)
- 備考: 初回エントリ

## 2026-10-31: プロジェクト初期基盤の構築

- Worktree: foundation

### 実装内容

- Next.js App Router初期構成: `src/app/` のlayout/pageを日本語・アプリ名に更新(create-next-app雛形を置き換え)
- TypeScript: 既存tsconfigを維持(strict / bundler / `@/*`エイリアス)。`pnpm typecheck`スクリプト追加
- ESLint: flat configのまま、テスト成果物・Firebaseローカル成果物をignore追加
- Vitest: `vitest.config.mts` 新規(@vitejs/plugin-react + `resolve.tsconfigPaths: true` で `@/` 対応、jsdom環境)。`src/lib/firebase/config.test.ts` に7件の単体テスト
- Playwright: `playwright.config.ts` 新規(chromiumのみ、`webServer`でdev server自動起動)。`e2e/home.spec.ts` にスモークテスト
- Firebase設定: `firebase.json`(emulators: auth 9099 / firestore 8080 / storage 9199 / ui 4000, singleProjectMode), `.firebaserc`(demoプロジェクトのみ), `firestore.indexes.json`(空)
- Security Rules: `firestore.rules` / `storage.rules` は全拒否の骨格のみ。docs/SECURITY_RULES.md のTODOをコメントで明記(推測で完成させない方針)
- Firebase初期化モジュール: `src/lib/firebase/` に `config.ts`(env読み取り・Emulator設定)、`client.ts`(遅延初期化 + Emulator接続)、`admin.ts`(Admin SDK、Emulator環境変数経由)
- 環境変数: `.env.example`(全変数の説明), `.env.development`(demo-* + Emulator接続の開発デフォルト、コミット対象)。`.gitignore` に例外を追加
- README.md: プロジェクト固有の内容に全面更新

### 実行したテスト

- `pnpm lint` — 合格
- `pnpm typecheck` — 合格(`next typegen` 実行後)
- `pnpm test` — 合格(1ファイル7件)
- `pnpm build` — 合格(Cache Components / Partial Prefetching有効、`/`は静的生成)
- `pnpm test:e2e` — 合格(chromium 1件)
- `firebase emulators:exec 'echo OK'` — auth/firestore/storageが起動しrules構文エラーなし(JDK21で確認)

### 未解決事項

- Security Rulesは骨格(全拒否)のまま。実装 + Emulatorテストが必要
- Emulator単体テスト基盤(@firebase/rules-unit-testing等)は未導入
- AuthenticationのUI実装は未着手(Phase 0の残項目)
- Cloud Functionsの雛形なし(firebase.jsonにもfunctions設定なし)
- CI設定なし

### 次の担当者への注意事項

- **JDK 21以上必須**: firebase-tools 15系はJava 21+が必要。この環境はPATHがJDK17なので `JAVA_HOME=/opt/homebrew/opt/openjdk@21` を付けて `pnpm emulators` を実行すること
- **typegen**: `pnpm typecheck` は `LayoutProps` などの生成型に依存。初回は `pnpm exec next typegen` か `pnpm dev`/`build` 実行後に行う(`.next/` はgit管理外で再生成される)
- **本番接続禁止**: `.env.development` はdemo-*プロジェクト固定。本番Firebaseの値をコミットしない。`NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false` にしないこと
- **Rulesは全拒否**: 現状どのユーザーもFirestore/Storageを読み書きできない。アプリ側の接続実装と同時にRules+Emulatorテストを進める必要がある
- **Next.js 16の差分**: async request API必須、`middleware.ts`ではなく`proxy.ts`、cacheComponents前提の設計(use cache / Suspense)。新規コードを書く前に `node_modules/next/dist/docs/` を参照
- **金額は整数円**: 実装時はdocs/ACCOUNTING_RULES.mdに従う
- Playwrightはchromiumのみ設定済み。firefox/webkitが必要になったらprojectsに追加 + `playwright install`
