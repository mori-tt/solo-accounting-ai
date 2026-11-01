# REVIEW_TEST.md

対象: `main...mori-tt/qa-review` 差分(PR #1 foundation マージ相当)
レビュー日: 2026-10-31

## 総評

- **Blocker: なし**(本PRは基盤構築であり、現状のテストはこの範囲では妥当)
- ただし AGENTS.md の Required Checks にある **「Firebase Emulator tests」
  が存在しない**点は、Rules 実装を伴う次のPRでは Blocker 扱いにすべき。
- 既存テスト: `src/lib/firebase/config.test.ts` の7件(単体) +
  `e2e/home.spec.ts` の1件(E2Eスモーク)。`@/` エイリアス解決は
  実測で確認済み(Vite 8 の `resolve.tsconfigPaths` が機能)。

---

## T1 [High] Security Rules の Emulator テストがゼロ

- ファイル: `firestore.rules` / `storage.rules` / `package.json` /
  `vitest.config.mts`
- 行: `package.json` scripts、`vitest.config.mts` include パターン
- 問題:
  - `@firebase/rules-unit-testing`(後継の `@firebase/rules-unit-testing`
    相当パッケージ)が devDependencies にない。
  - `pnpm test` の include は `src/**` と `tests/**` だが、
    `tests/` ディレクトリ自体が存在しない。
  - REVIEW.md の「`firebase emulators:exec 'echo OK'`」は rules の
    構文検証のみで、認可動作のテストではない。
- 影響: AGENTS.md「Security Rulesをテストする」「Firebase Emulator tests」を
  Required Check とする規約に対し、Rules を実装する次のPRで検証手段が
  ないまま書き始めることになる。認可抜けを見逃す最大のリスク。
- 修正案:
  1. `@firebase/rules-unit-testing` を devDependencies に追加。
  2. `tests/rules/firestore.test.ts` / `storage.test.ts` を作成し、
     `firebase emulators:exec` 経由で実行するスクリプト
     (例: `test:rules`)を追加。
  3. 最低限の検証ケース(非メンバー拒否・viewer書込拒否・
     editorのmember/期間操作拒否・締め済み変更拒否・
     auditLogs改ざん拒否・aiSuggestion書込拒否)を実装。

## T2 [High] CI / 自動実行の仕組みがない

- ファイル: リポジトリ全体(CI 設定ファイルなし)
- 行: `PLAN.md` Phase 0 の「CI」未チェック
- 問題: `pnpm lint` / `typecheck` / `test` / `build` / Emulator tests を
  自動実行する CI が存在しない。Required Checks の遵守が
  各開発者の手動実行に依存する。
- 影響: レビュー通過品質が属人化し、Rules 変更や金額ロジックの
  リグレッションを検出できないままマージされ得る。
- 修正案: GitHub Actions 等で Required Checks を PR 時に実行する。
  Emulator テストは `firebase emulators:exec` を JDK21 環境で実行する
  ジョブを追加。

## T3 [Medium] E2E が Firebase Emulator 非依存

- ファイル: `package.json` / `playwright.config.ts` / `e2e/home.spec.ts`
- 行: `test:e2e` スクリプト、`webServer.command: "pnpm dev"`
- 問題: Playwright は dev server を起動するが Firebase Emulator は
  起動しない。現状のトップページは静的で問題ないが、認証・Firestore
  連携の画面が追加されると E2E が失敗する(または本番接続を試みる)。
- 影響: 認証実装後の E2E が環境依存で不安定になり、
  「Emulator 未起動で書き込みが本番へ行く」構成ミスを見逃す可能性。
- 修正案: `test:e2e` を `firebase emulators:exec` で包むか、
  Playwright の `webServer` を複数化して Emulator も起動する。
  Emulator データは `emulator-data/` に export/import できる構成にする。

## T4 [Medium] Firebase 初期化モジュールのテスト不足

- ファイル: `src/lib/firebase/client.ts` / `src/lib/firebase/admin.ts`
- 行: `connectEmulators()` / `getAdminApp()`
- 問題: `config.test.ts` は純粋関数(`getFirebaseConfig` /
  `shouldUseEmulator` / `parseEmulatorHost`)のみをカバー。
  `connectEmulators` の二重接続耐性、`getAdminApp` の projectId
  フォールバック、emulator env 解釈は未テスト。
- 影響: REVIEW_SECURITY.md S3 の HMR 二重接続クラッシュや、
  S2 の projectId フォールバックはテストがないと再発・残存を検出できない。
- 修正案: client.ts は Firebase app をモックした単体テスト、
  admin.ts は Emulator 起動下の統合テスト(`test:rules` に含める)で
  フォールバック挙動を検証する。

## T5 [Low] `parseEmulatorHost` のエッジケース未カバー

- ファイル: `src/lib/firebase/config.test.ts`
- 行: `parseEmulatorHost` 関連 describe (L46-69)
- 問題: `"localhost:"`(port 0 バグ、REVIEW_SECURITY S5)、負数、
  ポート範囲外(`99999`)、コロン過多(`a:8080:b`)のケースがない。
- 影響: S5 のバグがテストで検出されずに残る。
- 修正案: 上記ケースを追加し、フォールバック返却を期待値にする。

## T6 [Low] vitest のグローバル環境が jsdom

- ファイル: `vitest.config.mts`
- 行: `test.environment: "jsdom"`
- 問題: Rules テスト・Admin SDK テスト・サーバーサイドロジックは
  Node 環境が自然だが、グローバルに jsdom が強制される。
- 影響: Node 専用 API を使うテストが環境差異で不安定になる。
  jsdom 下での Admin SDK / rules-unit-testing 動作は未検証。
- 修正案: `environment: "node"` をデフォルトにし、React コンポーネント
  テストだけ `// @vitest-environment jsdom` pragma で切替える
  (または `environmentMatchGlobs` を使用)。

## T7 [Low] `firestore.indexes.json` が空

- ファイル: `firestore.indexes.json`
- 問題: 現状空。Transactions の期間×科目・status 別クエリ等、
  複合クエリが必要になると即座に複合 index が必要になる。
- 影響: 実装時にクエリが `failed-precondition` で失敗し、
  その場しのぎのクエリ変更でスコープ漏れを誘発する可能性。
- 修正案: Firestore クエリを実装する際に、使用する複合クエリを
  `firestore.indexes.json` に同時追加する運用をドキュメント化する。

---

## 既存テストの評価

- `config.test.ts`: 環境変数の stub/unstub が `afterEach` で確実に
  行われており、追加した `@/` エイリアス解決テストもパスを確認。
  品質は妥当。
- `e2e/home.spec.ts`: スモークとして適切。heading の role ベース選択は良い。

## 次の実装PRで必須となるテスト(対象コードができ次第)

- Rules Emulator テスト(T1 のケース一覧)
- 金額の整数性・税計算の丸め(切り捨て)の単体テスト
- 年度境界(`fiscalYearStartMonth` ≠ 1)の期間計算テスト
- status 遷移(draft→confirmed→locked)の単体・Rules 両方
- AI 提案のクライアント書き込み拒否(Rules)+ 承認時の auditLog 出力
- businessId を跨ぐ read/write の拒否テスト
