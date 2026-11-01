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

## 2026-10-31: AI支援機能の実装(Phase 4コア)

- Worktree: ai-accounting
- 変更内容: AI提案のライフサイクル管理を実装。`businesses/{businessId}/aiSuggestions` コレクションで5種類の提案(証憑抽出/勘定科目候補/重複候補/取引内容説明/月次変動説明)を管理
- 変更ファイル: `src/lib/ai/types.ts`, `errors.ts`, `schemas.ts`, `provider.ts`, `heuristic-provider.ts`, `store.ts`, `firestore-store.ts`, `service.ts`, `service.test.ts`, `tests/firestore/ai-suggestions.rules.test.ts`, `docs/FIRESTORE_SCHEMA.md`, `docs/AI_POLICY.md`, `docs/DECISIONS.md`(ADR-0005), `firestore.rules`(コメント), `next.config.ts`, `package.json`

### 実装の要点

- `AISuggestionService`: `run`(提案生成) / `retry`(再実行) / `accept` / `reject`。accepted/rejectedは再実行不可
- 状態遷移: 成功=`pending`、必須項目欠落=`needs_review`+issuesコード、失敗(timeout/provider_error/invalid_response)=`needs_review`+lastError
- zodで生AIレスポンスを検証。形が不正なら`invalid_response`としてneeds_review(再実行可能)
- confidenceは0..1に丸めて保存、reasonはAI未返却時にフォールバック文言を生成して必ず保存
- AI出力は`payload`に隔離し、Transaction等の確定フィールドには一切書き込まない(acceptしてもconfirmedにならない)
- プロバイダの生エラーメッセージは証憑内容を含み得るため保存せず`provider_error`に汎用化(個人情報非ログ方針)
- `AIProvider`インターフェースで外部APIと疎結合。開発用に決定論的な`HeuristicAIProvider`を同梱
- ストア抽象化: `AISuggestionStore`(本番=`FirestoreSuggestionStore`/Admin SDK、テスト=`InMemorySuggestionStore`)
- 監査ログ: `run_ai`/`approve_ai`/`reject_ai`をauditLogsに記録(対象パスのみ、内容は記録しない)

### 実行したテスト

- `pnpm lint` — 合格
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(24件。service.test.ts 21件 + rules 3件)
- `pnpm build` — 合格
- Firebase Emulator tests — 合格(JDK21で起動、FIRESTORE_EMULATOR_HOST指定でrules 3件実行。クライアントからのaiSuggestions読み書き拒否を確認)

### 未解決事項

- 実際のAIプロバイダ(LLM API)は未接続。`AIProvider`実装を追加すれば差し替え可能
- UI/API層(Route Handler等)は未実装。認証実装後にserviceを呼ぶ経路を追加する
- aiSuggestionsへのクライアントreadは現行全拒否Rulesのまま。UI実装時にmembersロールでread許可を検討

### 次の担当者への注意事項

- `aiSuggestion` mapフィールド(Transactions/Receipts)は最新提案への参照のみ。提案本体はaiSuggestionsコレクション
- Emulatorテストは `FIRESTORE_EMULATOR_HOST=localhost:8080` を付けて `pnpm test` を実行すると有効になる
- このworktreeはnode_modules/.nextがメインチェックアウトへのシンボリンク。Turbopackがルート外解決を拒否するため `next.config.ts` の `experimental.turbopackAdditionalRoots` で実体の親ディレクトリを許可した(通常チェックアウトでは自動的に無効化)

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
