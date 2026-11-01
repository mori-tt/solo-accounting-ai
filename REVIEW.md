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

## 2026-11-02: `.next` symlink 除去と main のビルド破壊修復

- Worktree: fix-next-symlink

### 実装内容

- `.next`(リポジトリルート): sharedDirectories 由来の絶対パス symlink が誤コミットされていたのを `git rm` で除去。GitHub公開リポジトリにローカルパスが残るのと、symlinkが自己ループで実ディレクトリを生成できず `next dev`/`build` が壊れるため
- `.gitignore`: `/.next/` → `/.next`、`/.firebase/` → `/.firebase`。末尾スラッシュ付きパターンはディレクトリにしか効かず symlink(ファイル扱い)を無視できないため、`git add -A` で再混入し得た。`node_modules` は末尾スラッシュなしで元から安全
- `orca.yaml`: `sharedDirectories` から `node_modules` と `.next` を除外。前回の環境メモ通り symlink 共有は Turbopack の root 解決と型生成物参照を壊し build/typecheck が失敗する。各 worktree は実体 `pnpm install` 前提。`.firebase` は残置(破壊実績なし)
- `src/app/page.tsx` / `src/app/login/page.tsx`: 手解消ミスで `=======` マーカーだけが残ったままコミットされていたのを、`b8d3a06` の正規形(`/dashboard` リダイレクト版 / `LoginScreen`+`Suspense`版)へ復元
- `src/app/api/receipts/route.ts` / `[receiptId]/route.ts`: `getReceiptsBucket` → `getAdminBucket`。`f38ba5b` の admin.ts リファクタと旧 import がマージ `fdf5e02` で混在していた
- `src/app/layout.tsx`: `AuthProvider`(`@/lib/firebase/auth-provider`)→ `AppProvider`(`@/components/auth-provider`)へ `b8d3a06` 版に復元。全画面が使う `useApp` の Provider が未マウントで static export が全滅していた

### 実行したテスト

- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(18ファイル213件、skip 7)
- `pnpm build` — 合格(全ルート static prerender)
- Firebase Emulator tests — 未実施。この環境は JDK 17 のみで firebase-tools が JDK 21+ を要求し起動不可。rules 変更なしのため実害なし。JDK 21+ 導入後に `pnpm test:rules` / `pnpm test:emulators` で要確認

### 未解決事項・次の担当者への注意事項

- `src/lib/firebase/auth-provider.tsx`(`AuthProvider`/`useAuth`)と `src/app/auth-status.tsx` は現状どこからも参照されない死コード。削除は別タスクが安全
- main 上で同様の誤マージが他ファイルに潜んでいないかは未検証(マーカー grep と全チェック通過で実害は潰したが、意味論的な取り違えは残り得る)
- 今後作成される worktree には `node_modules` が無いため、作成直後に `pnpm install --frozen-lockfile` が必要。`.env.local` は `.worktreeinclude` で複製されるが未存在なら別途用意する

## 2026-11-01: Firestore設計の確定(AI提案コレクション化)

- Worktree: firebase-security

### 実装内容

- `docs/FIRESTORE_SCHEMA.md`: 提示された基本案に合わせて確定
  - 新規: `journalEntries`(仕訳: draft=候補/confirmed=確定/locked=締め済み、lines借貸・sourceType/sourceId/aiSuggestionId)、`closingChecks`(締めチェック: open/resolved/waived、fiscalPeriodId+type+targetPath+message)、`aiSuggestions`(提案: type/targetPath/suggestion/confidence/status(pending|accepted|rejected)/resolvedBy)
  - `expenses`に`status`(draft/confirmed/locked)と`receiptId`を追加(自身のlockedで締め保護。旧:紐付くTransaction経由)
  - `transactions`/`receipts`の`aiSuggestion`フィールドを廃止→`aiSuggestions`コレクションへ移行
  - 「領収書→OCR抽出→AI提案→ユーザー確認→確定経費→仕訳候補→ユーザー確定」のデータフローを明文化。AI出力はaiSuggestionsにのみ存在させる
  - 提案にない`users/{uid}`と`monthlySummaries`は維持(前者は認証プロファイル・実装済み、後者は月次集計要件F4対応)
- `docs/DECISIONS.md`: ADR-0005「AI提案はaiSuggestionsコレクションで管理」を追加、ADR-0003に補足
- `firestore.rules`: 新コレクション3件を追加
  - journalEntries: transactionsと同型(locked保護、aiSuggestionIdは作成後変更不可)
  - closingChecks: 作成はeditor+/openのみ、fiscalPeriodId/type/targetPathは事後変更不可、削除はopenのみ(editor)またはowner
  - aiSuggestions: readのみmember可、create/delete=禁止(Admin SDKのみ)。updateはeditor+かつstatus遷移+resolvedBy=本人のみ、内容(suggestion/confidence/targetPath/type)変更不可
  - expenses: 自身のstatusでlocked保護に変更(旧txLocked参照を廃止)
- `firestore.indexes.json`: journalEntries(status+date)、aiSuggestions(status+createdAt, targetPath+createdAt)、closingChecks(fiscalPeriodId+status+createdAt)を追加
- `src/lib/firebase/server.ts`: `setAiSuggestion`(フィールド書き込み)を`createAiSuggestion`(コレクション作成)に置き換え
- `docs/SECURITY_RULES.md`: 新コレクションの認可方針を追記
- テスト: journalEntries(5件)/aiSuggestions(6件)/closingChecks(6件)/デフォルト拒否(1件)/締め保護の拡充(locked journalEntry、locked紐付receipt、locked作成禁止)を追加

### 実行したテスト

- `pnpm lint` — 合格
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(1ファイル7件)
- `pnpm test:rules` — 合格(2ファイル62件。起動中の別Emulator(8080/9199)があったため `FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199 vitest run --config vitest.rules.config.mts` で既存Emulatorへ直接接続して実行)
- `pnpm build` — 合格

### 備考

- `monthlySummaries`は提示構成になかったが、月次集計(F4)・月次説明(monthly_explanation)の対象となるため維持。不要なら削除可能
- aiSuggestionsのupdateはstatus解決専用。`resolvedBy`は必須で本人uidのみ(他人名義の承認不可)
- closingChecksはサーバー生成(createdBy=`system`)とユーザーのカスタム項目(createdBy=uid)の両方を許容
- 起動中の別Emulatorがある場合、`pnpm test:rules`(emulators:exec)はport競合で失敗する。上記の直接接続方式か、既存Emulatorを停止してから実行すること

## 2026-10-31: Firebase基盤とセキュリティ

- Worktree: firebase-security

### 実装内容

- `firestore.rules`: docs/SECURITY_RULES.md準拠で全コレクション実装
  - `request.auth != null`必須、`businesses/{businessId}/members/{uid}`のロール(owner/editor/viewer)で認可
  - business作成と同一バッチで作成者本人をowner登録するブートストラップ(`getAfter()`でownerUid検証)。member管理はownerのみ
  - 締め済み保護: `status='locked'`のTransactionはupdate/delete不可、lockedへの変更はAdmin SDKのみ。`expenses`/`receipts`は紐付くTransactionのlockを参照。`fiscalPeriods`はownerのみ作成・締め可、closed後の再オープン・削除不可
  - `auditLogs`はappend-only(`actorUid == request.auth.uid`のみ追記可)
  - `aiSuggestion`フィールドはクライアント書き込み禁止(Admin SDKのみ)
  - `monthlySummaries`はクライアント書き込み禁止(Functions集計用)
  - `users/{uid}`は本人のみ読み書き可(個人情報保護)
  - 金額の整数(`is int`)・日付形式(YYYY-MM-DD)・statusenumの入力検証も実施
- `storage.rules`: `receipts/{businessId}/{receiptId}/{fileName}`のみ。memberはread、owner/editorはcreate/update/delete。10MB上限・MIME制限(jpeg/png/webp/heic/pdf)。delete時に`request.resource`がnullになるためcreate/updateと分離
- `firestore.indexes.json`: transactions(status+date, type+date)/invoices(status+dueDate)/receipts(status+createdAt)/payments(invoiceId+date)/expenses(paidAt+paymentDueDate)/auditLogs(targetPath+createdAt)の複合インデックス
- Authentication(クライアント): `src/lib/firebase/auth.ts`(Google/メール・パスワードのsignin/signup/signOut、初回ログイン時の`users/{uid}`作成)、`auth-provider.tsx`(`AuthProvider` + `useAuth`、onAuthStateChanged)、`/login`ページ、`AuthStatus`コンポーネントを`/`に追加。layoutにAuthProviderを配置
- Admin SDK共通処理: `admin.ts`に`getAdminBucket()`追加(storageBucketをapp optionsに設定)。`server.ts`新規(`verifyIdToken`/`authenticate`(Bearer)/`getMemberRole`/`requireMemberRole`/`writeAuditLog`(識別情報のみ)/`setAiSuggestion`(サーバー専用))
- `.env.development`: admin用Emulator接続先(FIRESTORE_EMULATOR_HOST等)を追加
- Rulesテスト: `@firebase/rules-unit-testing@6.0.0`導入。`tests/rules/`にFirestore 32件・Storage 10件。`vitest.rules.config.mts`(node環境・直列)と`pnpm test:rules`(emulators:exec経由)を追加。`pnpm test`からはEmulator必須テストを除外

### 実行したテスト

- `pnpm lint` — 合格
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(1ファイル7件)
- `pnpm test:rules` — 合格(2ファイル42件、JAVA_HOME=/opt/homebrew/opt/openjdk@21で実行)
- `pnpm build` — 合格(`/`と`/login`ともに静的生成)
- `pnpm test:e2e` — 合格(chromium 1件)

### 備考

- **node_modules/.nextのシンボリックリンクを実ディレクトリに置き換え**: このworktreeでは共有node_modules(メインcheckout)へのシンボリックリンクが張られていたが、Turbopackが「workspace root外のファイルはコンパイル不可」でbuildエラーになるため、`pnpm install`でworktree内に実ディレクトリを作成(foundation worktreeと同じ構成)。なお、リンク経由でメインcheckoutのnode_modulesに`@firebase/rules-unit-testing`が残っている(無害、メイン側で`pnpm install`すれば整理される)
- `members`のロール更新はownerのみ。最後のownerが降格・脱退するケースの防止は未実装(rulesでのカウントが困難。将来Functionsでガードする想定)
- `invoices`/`payments`/`customers`/`projects`に対する締め済み期間の日付ベース保護は未実装。現在はTransactionの`locked`とそれに紐付くexpenses/receiptsのみ。期間全体の日付範囲ロックは期間締め機能(Phase 3)でAdmin SDK側の整合性処理と合わせて検討
- Storage Rulesのreadは`firestore.exists()`でmember確認のみ(ロール非依存)。viewerもread可

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
