# FIRESTORE_SCHEMA.md

Cloud Firestoreのデータモデル定義。
すべての事業データは `businesses/{businessId}` 配下にスコープし、
businessIdをまたいだアクセスを構造的に禁止する。

## 共通規約

- 金額フィールドは円単位の整数(`number`)で保存する
- 日時はFirestore `Timestamp`。日付のみ必要な場合は `YYYY-MM-DD` 文字列を併用可
- 全ドキュメントに `createdAt` / `updatedAt` / `createdBy` を持たせる
- AI出力は `aiSuggestions` コレクションに隔離し、確定データ(本体フィールド)とは分離する
- `status='locked'` は締め済みを示し、Admin SDKのみが設定できる

## コレクション構成

```
users/{uid}
businesses/{businessId}
businesses/{businessId}/members/{userId}
businesses/{businessId}/customers/{customerId}
businesses/{businessId}/projects/{projectId}
businesses/{businessId}/transactions/{transactionId}
businesses/{businessId}/expenses/{expenseId}
businesses/{businessId}/receipts/{receiptId}
businesses/{businessId}/invoices/{invoiceId}
businesses/{businessId}/payments/{paymentId}
businesses/{businessId}/journalEntries/{journalEntryId}
businesses/{businessId}/fiscalPeriods/{periodId}
businesses/{businessId}/closingChecks/{checkId}
businesses/{businessId}/aiSuggestions/{suggestionId}
businesses/{businessId}/monthlySummaries/{yyyyMM}
businesses/{businessId}/auditLogs/{auditLogId}
```

## データの流れ(領収書→確定仕訳)

```
receipts(証憑ファイル)
  → aiSuggestions[kind=receipt_extraction]   (OCR抽出結果・サーバー生成)
  → ユーザーが内容を確認・修正・確定
  → expenses(確定経費)
  → aiSuggestions(仕訳候補・サーバー生成)     ※journalEntries向けのkindは未実装
  → ユーザーが確認・承認
  → journalEntries(status: confirmed)        (確定仕訳)
```

- AIの出力は必ず `aiSuggestions` にのみ存在させる
- `expenses` / `journalEntries` の本体フィールドには、ユーザーの承認操作を
  経てのみ値を設定する。AIの結果をそのまま確定データとして保存しない
- 提案を採用した場合、確定データ側の `aiSuggestionId` に起源となった
  提案ドキュメントIDを記録し追跡可能にする

### users/{uid}

| Field | Type | Note |
|---|---|---|
| displayName | string | |
| email | string | |
| createdAt | Timestamp | |

### businesses/{businessId}

| Field | Type | Note |
|---|---|---|
| name | string | 事業名 |
| ownerUid | string | 作成者 |
| fiscalYearStartMonth | number | 会計年度開始月(1-12) |
| taxMode | string | `exempt` / `simple` / `standard` 消費税課税方式 |
| openingBalances | array | 期首残高 `{ fiscalYear, accountCode, amount }[]`。amountは円・整数、借方残高を正・貸方残高を負とする。任意 |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/members/{userId}

| Field | Type | Note |
|---|---|---|
| role | string | `owner` / `editor` / `viewer` |
| invitedBy | string | uid |
| createdAt | Timestamp | |

### businesses/{businessId}/transactions/{transactionId}

| Field | Type | Note |
|---|---|---|
| type | string | `income` / `expense` / `transfer` |
| date | string | YYYY-MM-DD |
| amount | number | 円・整数 |
| account | string | 勘定科目コード |
| counterparty | string | 取引先名 |
| description | string | 摘要 |
| receiptIds | string[] | 紐付く証憑 |
| status | string | `draft` / `confirmed` / `locked`(締め済み) |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/expenses/{expenseId}

確定経費。証憑・AI提案をユーザーが確認したうえで作成する。

| Field | Type | Note |
|---|---|---|
| receiptId | string? | 証憑リンク |
| transactionId | string? | 対応する支払Transaction(消込) |
| taxCategory | string | 課税/非課税/免税/不課税 |
| taxAmount | number | 消費税額(円・整数) |
| paymentDueDate | string? | YYYY-MM-DD(未払管理) |
| paidAt | string? | YYYY-MM-DD |
| status | string | `draft` / `confirmed` / `locked`(締め済み) |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/receipts/{receiptId}

| Field | Type | Note |
|---|---|---|
| storagePath | string | Cloud Storage上のパス |
| fileName | string | |
| mimeType | string | |
| transactionId | string? | 紐付け先 |
| status | string | `unprocessed` / `linked` / `archived` |
| createdBy | string | uid |
| createdAt | Timestamp | |

### businesses/{businessId}/customers/{customerId}

| Field | Type | Note |
|---|---|---|
| name | string | |
| email | string? | |
| address | string? | |
| createdAt | Timestamp | |

### businesses/{businessId}/projects/{projectId}

| Field | Type | Note |
|---|---|---|
| customerId | string | |
| name | string | |
| status | string | `active` / `done` / `archived` |
| createdAt | Timestamp | |

### businesses/{businessId}/invoices/{invoiceId}

| Field | Type | Note |
|---|---|---|
| customerId | string | |
| projectId | string? | |
| issueDate | string | YYYY-MM-DD |
| dueDate | string | YYYY-MM-DD |
| items | array | [{ description, quantity, unitPrice, amount, taxRate, taxAmount }] ※unitPrice/amountは税込、taxRateは `standard`(10%) / `reduced`(8%)、taxAmountは明細の内税額 |
| totalAmount | number | 円・整数(税込) |
| taxAmount | number? | 消費税合計(円・整数・明細ごと切り捨ての合算)。税フィールド導入前データは未設定 |
| status | string | `draft` / `issued` / `paid` / `overdue` |
| createdAt | Timestamp | |

### businesses/{businessId}/payments/{paymentId}

| Field | Type | Note |
|---|---|---|
| invoiceId | string | 消込先 |
| date | string | YYYY-MM-DD |
| amount | number | 円・整数 |
| transactionId | string? | 対応する入金Transaction |
| createdAt | Timestamp | |

### businesses/{businessId}/journalEntries/{journalEntryId}

仕訳。`status='draft'` は仕訳候補、`confirmed` が確定仕訳。

| Field | Type | Note |
|---|---|---|
| date | string | YYYY-MM-DD |
| description | string | 摘要 |
| lines | array | [{ account, debit, credit }] 借方/貸方金額は円・整数 |
| sourceType | string | `manual` / `transaction` / `expense` / `invoice` 生成元種別 |
| sourceId | string? | 生成元ドキュメントID |
| aiSuggestionId | string? | 採用したAI提案のID(追跡用・作成時のみ設定) |
| status | string | `draft` / `confirmed` / `locked`(締め済み) |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/fiscalPeriods/{periodId}

periodIdは `fy{fiscalYear}`(会計年度開始年)で決定的に採番する。

| Field | Type | Note |
|---|---|---|
| fiscalYear | number | 会計年度の開始年 |
| startDate | string | YYYY-MM-DD |
| endDate | string | YYYY-MM-DD |
| status | string | `open` / `closed` |
| closedAt | Timestamp? | |
| closedBy | string? | uid |

### businesses/{businessId}/closingChecks/{checkId}

締めチェックリスト項目。サーバー生成・またはユーザーによるカスタム項目。

| Field | Type | Note |
|---|---|---|
| fiscalPeriodId | string | 対象期間 |
| type | string | `missing_receipt` / `unpaid_expense` / `unpaid_invoice` / `custom` |
| targetPath | string? | 関連ドキュメントのパス(識別情報のみ) |
| message | string | チェック内容の説明 |
| status | string | `open` / `resolved` / `waived` |
| createdBy | string | uid(サーバー生成時は `system`) |
| createdAt | Timestamp | |
| resolvedBy | string? | uid |
| resolvedAt | Timestamp? | |

### businesses/{businessId}/monthlySummaries/{yyyyMM}

| Field | Type | Note |
|---|---|---|
| totalIncome | number | 円・整数 |
| totalExpense | number | 円・整数 |
| accountBreakdown | map | 科目別集計 |
| computedAt | Timestamp | 再計算日時 |

### businesses/{businessId}/auditLogs/{auditLogId}

| Field | Type | Note |
|---|---|---|
| actorUid | string | |
| action | string | `create` / `update` / `delete` / `close` / `run_ai` / `approve_ai` / `reject_ai` |
| targetPath | string | 対象ドキュメントのパス |
| createdAt | Timestamp | |

※ 個人情報・証憑内容のスナップショットは保存しない。対象の識別情報のみ記録する。
AI関連のactionは `run_ai` / `approve_ai` / `reject_ai` を使う。

※ `transactions`/`receipts` の `aiSuggestion` mapフィールドは廃止済み(ADR-0005)。
AI提案はすべて `aiSuggestions` コレクションで管理する。

### businesses/{businessId}/aiSuggestions/{suggestionId}

AI提案のライフサイクルを管理するコレクション(ADR-0005)。
`aiSuggestion` mapフィールドの代わりに、状態遷移・再実行・監査を可能にするため独立したドキュメントとする。
書き込みはサーバーサイド(Admin SDK)のみ。

| Field | Type | Note |
|---|---|---|
| kind | string | `receipt_extraction` / `account_suggestion` / `duplicate_detection` / `transaction_description` / `monthly_explanation` |
| target | map | `{ type: receipt/transaction/monthlySummary, id }` 対象の識別情報 |
| status | string | `pending` / `accepted` / `rejected` / `needs_review` |
| payload | map? | 提案値(kindごとの構造)。失敗時はnull |
| confidence | number | 信頼度 0..1 |
| reason | string | 提案の根拠(AI未返却時はシステム生成) |
| issues | string[] | needs_reviewの理由コード(例: `amount_unreadable`, `timeout`) |
| attempts | number | 実行回数(retryで増加) |
| retriable | boolean | 再実行可能か |
| lastError | map? | `{ code: timeout/provider_error/invalid_response, message }` 個人情報を含めない |
| decidedBy | string? | 承認/拒否したuid |
| decidedAt | Timestamp? | |
| rejectReason | string? | ユーザーの拒否理由 |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/idempotencyKeys/{hashedKey}

冪等性管理用の内部コレクション。コマンドの冪等キーをSHA-256でハッシュ化したIDで保存し、
リプレイ時に同じ結果を返す。クライアントから直接操作しない。

| Field | Type | Note |
|---|---|---|
| key | string | コマンドの冪等キー |
| value | map | 初回実行時のコマンド結果 |
| createdAt | Timestamp | |

## Storage

```
receipts/{businessId}/{receiptId}/{fileName}
```

Storage RulesでもbusinessIdスコープを検証する。
