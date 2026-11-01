# FIRESTORE_SCHEMA.md

Cloud Firestoreのデータモデル定義。
すべての事業データは `businesses/{businessId}` 配下にスコープし、
businessIdをまたいだアクセスを構造的に禁止する。

## 共通規約

- 金額フィールドは円単位の整数(`number`)で保存する
- 日時はFirestore `Timestamp`。日付のみ必要な場合は `YYYY-MM-DD` 文字列を併用可
- 全ドキュメントに `createdAt` / `updatedAt` / `createdBy` を持たせる
- `aiSuggestion` は提案データ。確定データ(本体フィールド)とは分離して保持する

## コレクション構成

```
users/{uid}
businesses/{businessId}
businesses/{businessId}/members/{uid}
businesses/{businessId}/transactions/{transactionId}
businesses/{businessId}/expenses/{expenseId}
businesses/{businessId}/receipts/{receiptId}
businesses/{businessId}/customers/{customerId}
businesses/{businessId}/projects/{projectId}
businesses/{businessId}/invoices/{invoiceId}
businesses/{businessId}/payments/{paymentId}
businesses/{businessId}/monthlySummaries/{yyyyMM}
businesses/{businessId}/fiscalPeriods/{periodId}
businesses/{businessId}/auditLogs/{logId}
businesses/{businessId}/aiSuggestions/{suggestionId}
```

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
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/members/{uid}

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
| aiSuggestion | map? | 最新の提案への参照(`aiSuggestions/{id}`)。確定値と分離 |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/expenses/{expenseId}

Transactionのうち経費に特化した補助データ(必要に応じてTransactionへ統合可)。

| Field | Type | Note |
|---|---|---|
| transactionId | string | 対応するTransaction |
| taxCategory | string | 課税/非課税/免税/不課税 |
| taxAmount | number | 消費税額(円・整数) |
| paymentDueDate | string? | YYYY-MM-DD(未払管理) |
| paidAt | string? | YYYY-MM-DD |

### businesses/{businessId}/receipts/{receiptId}

| Field | Type | Note |
|---|---|---|
| storagePath | string | Cloud Storage上のパス |
| fileName | string | |
| mimeType | string | |
| transactionId | string? | 紐付け先 |
| status | string | `unprocessed` / `linked` / `archived` |
| aiSuggestion | map? | 最新の抽出提案への参照(`aiSuggestions/{id}`) |
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
| items | array | [{ description, quantity, unitPrice, amount }] |
| totalAmount | number | 円・整数 |
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

### businesses/{businessId}/monthlySummaries/{yyyyMM}

| Field | Type | Note |
|---|---|---|
| totalIncome | number | 円・整数 |
| totalExpense | number | 円・整数 |
| accountBreakdown | map | 科目別集計 |
| computedAt | Timestamp | 再計算日時 |

### businesses/{businessId}/fiscalPeriods/{periodId}

| Field | Type | Note |
|---|---|---|
| startDate | string | YYYY-MM-DD |
| endDate | string | YYYY-MM-DD |
| status | string | `open` / `closed` |
| closedAt | Timestamp? | |
| closedBy | string? | uid |

### businesses/{businessId}/auditLogs/{logId}

| Field | Type | Note |
|---|---|---|
| actorUid | string | |
| action | string | `create` / `update` / `delete` / `close` / `approve_ai` |
| targetPath | string | 対象ドキュメントのパス |
| createdAt | Timestamp | |

※ 個人情報・証憑内容のスナップショットは保存しない。対象の識別情報のみ記録する。
AI関連のactionは `run_ai` / `approve_ai` / `reject_ai` を使う。

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

## Storage

```
receipts/{businessId}/{receiptId}/{fileName}
```

Storage RulesでもbusinessIdスコープを検証する。
