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

### 締め済み期間の保護

- 対象ドキュメントの日付が `status = closed` の `fiscalPeriod` に含まれる場合、
  update/deleteを拒否する
- `fiscalPeriods` 自体の `close` 操作はownerのみ

### 監査ログ

- `auditLogs` はappend-only(createのみ可、update/delete不可)

### AI提案

- `aiSuggestion` フィールドの書き込みはサーバーサイド(Admin SDK経由)のみ
- クライアントは読み取りのみ

## Storage Rules

- パスは `receipts/{businessId}/...` のみ許可
- 対応するFirestore memberドキュメントでロールを検証する
- viewerは読み取りのみ、editor/ownerはアップロード可
- ファイルサイズ・MIMEタイプの上限を設ける

## テスト方針

Emulator Suiteで以下を検証する。

- 非メンバーがbusinessId配下を読み書きできないこと
- viewerが書き込みできないこと
- editorがmember管理・期間締めを行えないこと
- 締め済み期間データを変更できないこと
- auditLogsを改ざんできないこと
- aiSuggestionをクライアントから書けないこと
- StorageでもbusinessIdスコープ外へアクセスできないこと

## ログ・プライバシー

- 個人情報・証憑内容をログに出力しない(アプリ・Functions共通)
- auditLogsには対象の識別情報のみ記録し、内容のスナップショットは保存しない
