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
