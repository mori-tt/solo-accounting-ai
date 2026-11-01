# REVIEW_ACCOUNTING.md

対象: `main...mori-tt/qa-review` 差分(PR #1 foundation マージ相当)
レビュー日: 2026-10-31

## 総評

- **Blocker: なし**
- 本差分には会計ロジック(取引・金額・期間・集計)の実装コードが存在しない。
  レビュー対象は `docs/` のドメイン定義と `firestore.rules` の骨格のみ。
- ドキュメントレベルの規約(整数円・締め済み保護・AI分離)は一貫しており、
  矛盾は見当たらない。
- 以下は実装に先立って確定しておくべき論点と、構造上の注意点。

---

## A1 [Medium] 会計ルールの強制手段が Rules 骨格にのみ存在

- ファイル: `firestore.rules` / `docs/ACCOUNTING_RULES.md` /
  `docs/FIRESTORE_SCHEMA.md`
- 行: `firestore.rules` L6-10(TODO コメント)
- 問題: 「締め済み期間データの変更禁止」「金額は整数」「status 遷移
  (draft→confirmed→locked)」などの会計上不変な制約はドキュメントに
  記述されているが、強制するコードがまだどこにもない。Rules 骨格は
  これらのうち締め済み保護と aiSuggestion のみ TODO 化しており、
  金額の整数性・status 遷移制約は Rules 実装計画にも含まれていない。
- 影響: 実装者が Rules を書く際に締め済みチェックのみ実装し、
  `amount` に小数や負の不正値が入る検証、不正な status 遷移
  (locked→draft への逆戻り等)の拒否が抜け落ちる可能性。
- 修正案: Rules 実装時に以下も検証対象に含める。
  - `amount` / `taxAmount` / `totalAmount` が整数(`int` 相当)か
  - `status` の許可遷移(`draft→confirmed`、`confirmed→locked` は
    締め処理経由のみ、逆戻り不可)
  - `date` が `fiscalPeriods.status=closed` の期間に含まれるか
    (`startDate <= date <= endDate` の文字列比較で検証可能)

## A2 [Medium] Expense ↔ Transaction の二重管理による不整合リスク

- ファイル: `docs/FIRESTORE_SCHEMA.md`
- 行: `businesses/{businessId}/expenses/{expenseId}` 定義
- 問題: Expense は `transactionId` で Transaction を参照する補助データだが、
  両者を原子的に作成・更新・削除する仕組みが未定義。一方だけ作成される
  (二重登録・孤立レコード)可能性が構造上ある。ドキュメント自身も
  「必要に応じてTransactionへ統合可」と留保している。
- 影響: 経費の税区分(`taxCategory`)と取引本体の金額が乖離したり、
  Transaction 削除後に孤立 Expense が残り集計を歪める可能性。
- 修正案: 初回実装では Transaction に経費属性を内包する単一コレクションに
  寄せるか、分けるなら作成・削除を Cloud Functions のバッチ/トランザクション
  で一体化し、Rules で片方だけの直接 create/delete を拒否する方針を
  実装前に決定する。

## A3 [Medium] 年度境界・締め期間の判定基準が未確定

- ファイル: `docs/FIRESTORE_SCHEMA.md` / `docs/ACCOUNTING_RULES.md`
- 行: `fiscalPeriods` / `fiscalYearStartMonth` / `transactions.date`
- 問題:
  1. Transaction の日付は `YYYY-MM-DD` 文字列。締め済み判定は期間の
     `startDate <= date <= endDate` の文字列比較になるはずだが、
     Rules 実装での比較方法・タイムゾーン(JST)の扱いが未記述。
  2. `fiscalYearStartMonth` から `fiscalPeriods` をどう生成・連番するか
     (期間IDの採番規則、年度またぎの扱い)が未定義。
  3. 1つの Transaction が複数期間の境界条件に合致しないよう、
     期間の重複・隙間を防ぐ制約がない。
- 影響: 年度境界(会計年度開始月が1以外)や月末日の跨ぎで
  誤った期間への帰属・締め漏れが起き得る。
- 修正案: 期間生成ロジック(例: `periodId = f"{startYear}{startMonth:02d}"`)
  と日付比較規約を `docs/` に追記し、Rules では `date` の文字列範囲比較と
  期間重複チェック(Transaction 作成時に対象期間が1つに特定できること)を
  Emulator テストで検証する。

## A4 [Medium] AI 提案採用の「確定」操作の定義が未実装レベルで曖昧

- ファイル: `docs/AI_POLICY.md` / `docs/FIRESTORE_SCHEMA.md`
- 行: `aiSuggestion` フィールド / 「提案の採用 = ユーザーが提案値を確定値へコピー」
- 問題: 「ユーザー承認」をどの操作・どのフィールド変化で判定するかが
  ドキュメント止まり。クライアントが `aiSuggestion` の値をそのまま
  本体フィールドに書き込む操作は、Rules 上は通常の update と区別できず、
  「AIが書いた」のか「人が確定した」のかを区別する仕組みが必要。
- 影響: 実装によっては、UI側のバグや悪意あるクライアントが
  aiSuggestion を無承認で本体へコピーしても Rules で止められない
  (ただし「ユーザーが書いた」という意味では Rules の責務外ともいえる)。
- 修正案: 承認操作を監査可能にするため、`auditLogs` に `approve_ai`
  アクションを記録する設計(既に schema に存在)を実装側で必須化し、
  確定操作を専用の Server Action / Cloud Function 経由にして
  `confirmed` への遷移をそこに限定する方針を明記する。

## A5 [Low] 金額フィールドの整数性を守る仕組みが未整備

- ファイル: `docs/ACCOUNTING_RULES.md` / 実装コードなし
- 行: 「金額はすべて円単位の整数」
- 問題: 整数円の規約は ADR-0002 で確定しているが、バリデーション層
  (zod 等)での整数チェックや、税計算の丸め(切り捨て)ユーティリティが
  まだ存在しない。`zod` は package.json にあるが未使用。
- 影響: 実装者ごとに `Math.round`/`toFixed` 等を使い分けると、
  端数処理が Business 設定(切り捨て)とずれる可能性。
- 修正案: 金額の入力検証・税計算を `src/lib/accounting/` のような
  共通モジュールに集約し、`zod` の `z.number().int()` で
  境界を統一する方針を実装前に決める。

## A6 [Low] 二重登録の防止策が未設計

- ファイル: `docs/FIRESTORE_SCHEMA.md` / `docs/AI_POLICY.md`
- 行: `payments.invoiceId` / `receipts.transactionId` / 重複検出機能
- 問題: Payment の二重消込(同一 invoiceId への複数登録)や
  Receipt の複数 Transaction への紐付けについて、一意性をどう担保するか
  (複合ID・トランザクション・Rules)が未定義。AI の重複検出は
  「検出して提案する」のみで、防ぐ側の制約はない。
- 影響: 二重入金や証憑の二重計上が発生しても検出に頼るのみで、
  書き込み時点では防げない。
- 修正案: Payment 作成時に invoice の残高をトランザクションで検証するか、
  消込サマリを invoice 側で保持する設計を検討。Receipt の `transactionId`
  一意制約は Rules では困難なため、アプリ側のトランザクションで担保する。

---

## 確認済み・問題なし(ドキュメントレベル)

- 金額は円整数(ADR-0002)・AI提案と確定分離(ADR-0003)が方針として明確。
- `monthlySummaries` を再計算可能な集計とし手計算値の保存を禁じる方針あり。
- `auditLogs` に個人情報・証憑内容を保存しない方針あり。
- `taxMode`(exempt/simple/standard)と `taxCategory` の区分が定義済み。

## 実装PRで必ず確認すべき項目

- `amount` が浮動小数点を経由していないこと(JSON 数値入力時も)
- 年度境界(`fiscalYearStartMonth` が 1 以外)での期間計算テスト
- 締め済み期間の update/delete が Rules で拒否されること
- AI 提案採用が `approve_ai` の auditLog を伴うこと
- Payment 消込の残高照合(over-payment 防止)
