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

## 2026-10-31: 経理ドメインの実装

- Worktree: accounting-domain

### 実装内容

- `src/lib/accounting/domain/`: Firebase非依存の純粋なドメインロジック
  - `errors.ts`: `DomainError` + エラーコード(`INVALID_AMOUNT`/`INVALID_DATE`/`PERIOD_CLOSED`/`INVALID_STATE`/`NOT_FOUND`/`ALREADY_EXISTS`/`PAYMENT_EXCEEDS_BALANCE`/`VALIDATION_FAILED`)
  - `money.ts`: 円整数バリデーション(0円・負数・小数・非安全整数を拒否)
  - `dates.ts`: `YYYY-MM-DD`実在日検証(うるう年対応)、`YYYY-MM`、日付比較・日数差
  - `fiscal.ts`: `fiscalYearStartMonth`から年度・会計期間を算出、締め済み期間の検出
  - `types.ts`: FIRESTORE_SCHEMA.mdに対応するエンティティ型。`idempotencyKey`フィールドを追加(冪等性用)
  - `validate.ts` / `transitions.ts` / `ai.ts` / `audit.ts` / `summary.ts` / `checks.ts`
- `src/lib/accounting/store.ts`: 永続化ポート `AccountingStore`(get/list/create/update/remove/findByIdempotencyKey/runInTransaction)。Firestoreアダプタは別実装とし、ドメイン層はこのポートのみに依存
- `src/lib/accounting/memory-store.ts`: InMemory実装。`runInTransaction`はスナップショット方式で失敗時ロールバック(原子性)
- `src/lib/accounting/service.ts`: `AccountingService`。全ての変更操作を `runInTransaction` 内で検証→書込→auditLogs記録の順に実行
  - 取引登録/更新/削除/確定、経費登録(Transaction+Expenseを原子的に作成)、支払記録、顧客・案件・請求書登録、入金消込(残額超過を拒否・全額でpaid化)、領収書の状態遷移(unprocessed/linked/archived)、月次集計の再計算、未入金・未払チェック、決算チェックリスト、会計期間のopen/close(期間内Transactionをlocked化)、AI提案の保存/採用/拒否、重複候補検出

### 設計上の判断

- 金額は正の円整数のみ許可(0円・負数は拒否)。方向はtypeで表現する
- `aiSuggestion`は専用メソッド経由でのみ書き込み。採用(accept)は提案値を確定フィールドへコピーするがstatusはdraftのまま — confirmedは別途ユーザーの確定操作が必須。拒否は確定値を一切変更しない
- AuditActionを `suggest_ai`/`reject_ai` で拡張(スキーマの列挙は例示扱い)
- 領収書↔取引の紐付けはlink/unlink操作のみが更新し両者を同一トランザクションで整合させる
- `receiptIds`は入力patchで直接変更不可
- 締め処理は期間内のdraft/confirmed全取引をlocked化。draft残存はチェックリストでblockerとして事前可視化
- monthlySummariesはconfirmed/locked取引のみ集計する派生データで、監査対象外
- `refreshInvoiceStatuses`はsystemアクターとしてissued→overdueを記録
- ExpenseのIDは対応Transactionと同一(1:1)として整合性を確保
- 会計ロジックは `src/lib/accounting/` に集約しUI(`src/app/`)には一切書いていない

### 実行したテスト

- `pnpm lint` — 合格
- `pnpm typecheck` — 合格(ローカル`.next`再生成後)
- `pnpm test` — 合格(8ファイル113件。金額0円/負数/小数、年度境界(4月始まりの3月末/4月初)、月末(大の月・うるう年2月)、二重登録(冪等キー再送)、未入金(全額/一部/過払い拒否/遅延日数)、未払(期限切れ検出・支払解消)、締め済み期間(登録/更新/削除/確定/支払記録の拒否・locked化・二重close拒否)、AI提案(採用してもconfirmedにならない/拒否で確定値不変/再操作拒否/信頼度範囲外)、状態遷移、監査ログ、トランザクション原子性)
- `pnpm build` — 合格
- Firebase Emulator tests — 該当なし(ドメイン層はFirestore非依存。Rules/Emulator検証はfirebase-security worktreeの範囲)

### 環境メモ(重要)

- このworktreeの `node_modules` / `.next` はメインcheckoutへのシンボリンクだったが、Turbopackのhermetic root解決により `pnpm build` が「Could not find the Next.js package」で失敗し、共有`.next`の型生成物が他worktreeのページを参照して `typecheck` も壊れていた。firebase-securityと同様に実体install(`rm`シンボリンク→`pnpm install --frozen-lockfile`)へ切り替えて解消。他のシンボリンク組worktree(web-ui, ai-accounting)でも同じ問題が出るはず
- 共有`.next`では複数worktreeのbuildがロック待ち・成果物を相互上書きするため、worktreeごとの実体`.next`の方が分離として正しい

### 未解決事項・次の担当者への注意事項

- `AccountingStore`ポートのFirestore実装(firebase-admin SDK + runTransaction + idempotencyKey一意制約)は未実装。Server Actions/Route Handlersからの接続はweb-ui側で行う
- `businessId`スコープのアクセス制御・`aiSuggestion`のクライアント書込禁止・auditLogs改ざん防止はSecurity Rules層(firebase-security worktree)の責務
- 個人事業主の消費税丸めルール(切り捨て)はvalidateにtaxAmount上限チェックのみ実装。税計算エンジン自体は未実装
- サービスの`asOf`/`today()`はUTC基準。JST基準が必要ならclock注入側で調整する
