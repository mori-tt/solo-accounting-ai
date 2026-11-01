# SECURITY_RULES.md

Firebase Security Rules(Firestore / Storage)の方針。

## 原則

- すべての事業データは `businesses/{businessId}` 配下にスコープする
- businessIdをまたいだアクセスは禁止する
- クライアントからの書き込みはロールに応じて制限する
- 締め済み期間のデータはクライアントから変更不可にする
- RulesはFirebase Emulatorテストで必ず検証する

## アクセス制御

### 認証

- すべての操作に `request.auth != null` を必須とする

### 認可(ロール)

`businesses/{businessId}/members/{uid}` の `role` により制御する。

| Role | read | create | update | delete | close |
|---|---|---|---|---|---|
| owner | ○ | ○ | ○ | ○ | ○ |
| editor | ○ | ○ | ○ | 制限あり | × |
| viewer | ○ | × | × | × | × |
| 非メンバー | × | × | × | × | × |

- memberドキュメントの存在を `exists()` で確認したうえで `get()` でロールを取得する
- `members` 自身の書き込みはownerのみ許可する(権限昇格防止)
  - 例外: business作成と同一バッチで、作成者本人を`owner`として登録する
    ブートストラップのみ許可(`getAfter()`で`ownerUid`を検証)
- editorのdelete「制限あり」の具体化:
  - transactions: `status='draft'` のみ削除可
  - invoices: `status='draft'` のみ削除可
  - receipts: `status='unprocessed'` のみ削除可
  - 上記以外の削除はownerのみ
- `businesses` ドキュメントのdeleteはクライアントから不可
  (サブコレクション残骸防止のためAdmin SDKのみ)
- `ownerUid` はクライアントから変更不可(所有権移転防止)
- `users/{uid}` は本人のみ読み書き可(個人情報保護)
- `monthlySummaries` はクライアントから書き込み不可(集計はFunctionsのみ)

### 締め済み期間の保護

- 締め処理(Admin SDK)でドキュメントの `status` を `locked` にする。
  `status = 'locked'` のドキュメント(transactions / expenses / journalEntries)は
  update/deleteを拒否する
- `status` を `locked` に変更する操作自体もクライアントからは不可(Admin SDKのみ)
- `receipts` は紐付くTransactionがlockedならupdate/deleteを拒否する
- `fiscalPeriods` の作成・更新(締め)はownerのみ。`closed` になった期間は
  クライアントから再オープン・削除不可
- `closingChecks` の `fiscalPeriodId` / `type` / `targetPath` は作成後に変更不可
  (チェック対象のすり替え防止)

### 監査ログ

- `auditLogs` はappend-only(createのみ可、update/delete不可)

### AI提案

- AI提案は `aiSuggestions` コレクションで管理する(ADR-0005)
- 提案ドキュメントの生成・削除はサーバーサイド(Admin SDK経由)のみ
- クライアントは `status`(pending/accepted/rejected)の解決と
  `resolvedBy`(本人のみ)の記録のみ可能。提案内容・対象・信頼度は変更不可
- 確定データ側の `aiSuggestionId` は作成時のみ設定可・以後変更不可(追跡性)

## Storage Rules

- パスは `receipts/{businessId}/{receiptId}/{fileName}` のみ許可
- 対応するFirestore memberドキュメントでロールを検証する
- viewerは読み取りのみ、editor/ownerはアップロード可
- 上限10MB、MIMEタイプは `image/jpeg` / `image/png` / `image/webp` /
  `image/heic` / `application/pdf` のみ

## テスト方針

Emulator Suiteで以下を検証する。

- 非メンバーがbusinessId配下を読み書きできないこと
- viewerが書き込みできないこと
- editorがmember管理・期間締めを行えないこと
- 締め済み期間データを変更できないこと
- auditLogsを改ざんできないこと
- aiSuggestionsをクライアントから生成・改ざんできないこと
- closingChecksの対象・種別を事後に改ざんできないこと
- StorageでもbusinessIdスコープ外へアクセスできないこと

## ログ・プライバシー

- 個人情報・証憑内容をログに出力しない(アプリ・Functions共通)
- auditLogsには対象の識別情報のみ記録し、内容のスナップショットは保存しない
