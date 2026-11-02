# FIRESTORE_SCHEMA.md

Cloud Firestoreのデータモデル定義。
すべての事業データは `businesses/{businessId}` 配下にスコープし、
businessIdをまたいだアクセスを構造的に禁止する。

## 共通規約

- 金額フィールドは円単位の整数(`number`)で保存する
- 日時はFirestore `Timestamp`。日付のみ必要な場合は `YYYY-MM-DD` 文字列を併用可
- 多くのドキュメントに `createdAt` / `updatedAt` / `createdBy` を持たせる。
  ただし expenses/payments/fiscalPeriods/monthlySummaries/auditLogs 等は
  一部または全部を持たない(各コレクションのフィールド表を参照)
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
businesses/{businessId}/withholdingRecords/{transactionId}
businesses/{businessId}/receipts/{receiptId}
businesses/{businessId}/invoices/{invoiceId}
businesses/{businessId}/quotes/{quoteId}
businesses/{businessId}/payments/{paymentId}
businesses/{businessId}/bills/{billId}
businesses/{businessId}/billPayments/{billPaymentId}
businesses/{businessId}/journalEntries/{journalEntryId}
businesses/{businessId}/recurringTemplates/{templateId}
businesses/{businessId}/recurringInvoiceTemplates/{templateId}
businesses/{businessId}/fixedAssets/{assetId}
businesses/{businessId}/inventoryItems/{itemId}
businesses/{businessId}/inventoryCounts/fy{fiscalYear}
businesses/{businessId}/fiscalPeriods/{periodId}
businesses/{businessId}/closingChecks/{checkId}
businesses/{businessId}/aiSuggestions/{suggestionId}
businesses/{businessId}/monthlySummaries/{yyyyMM}
businesses/{businessId}/auditLogs/{auditLogId}
businesses/{businessId}/idempotencyKeys/{hashedKey}
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
| lastLoginAt | Timestamp | 最終ログイン(upsert)日時 |
| createdAt | Timestamp | 初回作成時のみ設定 |

### businesses/{businessId}

| Field | Type | Note |
|---|---|---|
| name | string | 事業名 |
| ownerUid | string | 作成者 |
| fiscalYearStartMonth | number | 会計年度開始月(1-12) |
| taxMode | string | `exempt` / `simple` / `standard` 消費税課税方式 |
| customAccounts | object[] | 任意・最大50件。`{ code, label, kind: income\|expense, parentCode?, disabled? }` カスタム勘定科目・補助科目 |
| allocationRatios | map? | 家事按分の事業割合(科目コード→0-100の整数%)。未設定科目は100%扱い |
| openingBalances | array | 期首残高 `{ fiscalYear, accountCode, amount }[]`。amountは円・整数、借方残高を正・貸方残高を負とする。任意 |
| lastBackupAt | Timestamp? | 最終バックアップ(エクスポート)日時。`/api/backup` GET成功時またはCloud Functionsのスケジュールバックアップ成功時にサーバーが記録。未取得は未設定 |
| invoiceRegistrationNumber | string? | 適格請求書発行事業者の登録番号(T+13桁)。未登録(免税事業者等)は未設定 |
| issuerName | string? | 請求書の発行者名。未設定時は事業名を使う |
| issuerAddress | string? | 請求書に記載する発行者住所 |
| invoiceCounter | number? | 請求書番号の採番カウンタ(発行済みの最終連番)。未採番は未設定 |
| quoteCounter | number? | 見積番号の採番カウンタ(発行済みの最終連番)。未採番は未設定 |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/members/{userId}

| Field | Type | Note |
|---|---|---|
| uid | string | メンバーのuid(ドキュメントIDと同一。collectionGroupクエリ用に保持) |
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
| taxCategory | string? | `taxable` / `non_taxable` / `exempt` / `out_of_scope`。未設定は区分未分類(税フィールド導入前データ) |
| taxRate | string? | `standard`(10%) / `reduced`(8%)。taxCategory=taxable のときのみ有効(省略時 standard) |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/expenses/{expenseId}

確定経費。証憑・AI提案をユーザーが確認したうえで作成する。
登録時に `type=expense` のTransactionと同一コミットで作成され、
`transactionId` で1対1に対応する。状態はTransaction側の `status` で管理する。

| Field | Type | Note |
|---|---|---|
| transactionId | string | 対応する経費Transaction |
| taxCategory | string | `taxable` / `non_taxable` / `exempt` / `out_of_scope` |
| taxAmount | number | 消費税額(円・整数・0以上)。非課税・免税・不課税は0固定 |
| paymentDueDate | string? | YYYY-MM-DD(未払管理) |
| paidAt | string? | YYYY-MM-DD(支払済み日付) |

### businesses/{businessId}/withholdingRecords/{transactionId}

源泉徴収記録。`type=expense` のTransactionと1対1で紐付き、
ドキュメントIDは取引IDと同一(記録の存在自体が源泉徴収の対象フラグ)。
取引の登録・編集・削除と同一コミットで同期され、締め済み期間の保護は
リンク先取引の `status`/`date` から導出される(自身は日付を持たない)。
仕訳展開では `taxAmount` を貸方の預り金(源泉所得税)行として分離する。

| Field | Type | Note |
|---|---|---|
| transactionId | string | リンク先の支出取引(ドキュメントIDと同一) |
| category | string | `service_fee`(報酬・料金等) / `salary`(給与)。支払調書はservice_fee、源泉徴収票はsalary+専従者給与科目が対象 |
| paymentAmount | number | 源泉徴収の対象となる支払金額(円・整数・正数)。取引額以下 |
| taxAmount | number | 源泉徴収税額(円・整数・0以上) |
| calculation | string | `auto`(区分の税率で自動計算) / `manual`(手入力)。税額の由来を保持 |
| note | string? | 支払調書の細目欄に使うメモ |
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
| transactionDate | string? | YYYY-MM-DD。電帳法の検索要件用メタデータ(取引年月日)。紐付け時に取引値をコピー、未紐付は手入力で補完 |
| amount | number? | 円・整数・0以上。検索要件用メタデータ(取引金額) |
| counterparty | string? | 検索要件用メタデータ(取引先) |
| status | string | `unprocessed` / `linked` / `archived` |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

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
| invoiceNumber | string? | 請求書番号(`INV-`+6桁連番・作成時に採番)。連番導入前データは未設定 |
| customerId | string | |
| projectId | string? | |
| issueDate | string | YYYY-MM-DD |
| dueDate | string | YYYY-MM-DD |
| items | array | [{ description, quantity, unitPrice, amount, taxRate, taxAmount }] ※unitPrice/amountは税込、taxRateは `standard`(10%) / `reduced`(8%)、taxAmountは明細の内税額 |
| totalAmount | number | 円・整数(税込) |
| taxAmount | number? | 消費税合計(円・整数・明細ごと切り捨ての合算)。税フィールド導入前データは未設定 |
| status | string | `draft` / `issued` / `paid` / `overdue` |
| quoteId | string? | 転換元の見積ID(見積→請求変換で生成された場合のみ) |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/quotes/{quoteId}

見積書。`draft`→`sent`→`accepted`→`converted` のライフサイクルを持ち、
`sent`/`accepted` の見積から請求書へ転換できる(明細・顧客・案件をコピー、
invoice.quoteId と quote.convertedInvoiceId を相互参照する)。
会計仕訳を持たないが、発行日の締め済み期間への混入は請求書と同じく拒否する。

| Field | Type | Note |
|---|---|---|
| quoteNumber | string? | 見積番号(`EST-`+6桁連番・作成時に採番)。連番導入前データは未設定 |
| customerId | string | |
| projectId | string? | |
| issueDate | string | YYYY-MM-DD(見積発行日) |
| validUntil | string | YYYY-MM-DD(見積有効期限) |
| items | array | invoices と同じ構造 [{ description, quantity, unitPrice, amount, taxRate, taxAmount }] ※unitPrice/amountは税込 |
| totalAmount | number | 円・整数(税込) |
| taxAmount | number? | 消費税合計(円・整数)。税フィールド導入前データは未設定 |
| notes | string? | 帳票の備考欄に出す補足 |
| status | string | `draft` / `sent` / `accepted` / `converted` |
| convertedInvoiceId | string? | 転換先の請求書ID(status=convertedのとき設定) |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

※ 納品書は請求書から、発行領収書は入金(payments)からその都度派生する
帳票であり、専用コレクションは持たない(納品書番号は `{invoiceNumber}-D`)。

### businesses/{businessId}/payments/{paymentId}

| Field | Type | Note |
|---|---|---|
| invoiceId | string | 消込先 |
| date | string | YYYY-MM-DD |
| amount | number | 円・整数 |
| transactionId | string? | 対応する入金Transaction |
| createdAt | Timestamp | |

### businesses/{businessId}/bills/{billId}

取引先から受領した請求書(買掛)。支払は `billPayments` で消込し、
支払合計が `totalAmount` に達すると `status` が `paid` になる
(入金消込の買掛版)。期限超過は `dueDate` と基準日から都度判定し、
`overdue` ステータスは持たない。

| Field | Type | Note |
|---|---|---|
| vendorName | string | 取引先名(支払先) |
| totalAmount | number | 請求額(円・整数・税込) |
| receivedDate | string | 受領日 YYYY-MM-DD |
| dueDate | string | 支払期日 YYYY-MM-DD |
| description | string? | 摘要 |
| status | string | `unpaid` / `paid` |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/billPayments/{billPaymentId}

| Field | Type | Note |
|---|---|---|
| billId | string | 消込先 |
| date | string | YYYY-MM-DD(支払日) |
| amount | number | 円・整数(部分支払可・超過支払は不可) |
| transactionId | string? | 対応する支出Transaction |
| createdAt | Timestamp | |

### businesses/{businessId}/journalEntries/{journalEntryId}

仕訳。`status='draft'` は仕訳候補、`confirmed` が確定仕訳。

※ 現状このコレクションへの書き込み経路は未実装(Security Rulesと
バックアップ対象の定義のみ)。仕訳データは `domain/ledger.ts` の
`buildJournal` が transactions から都度計算する仮想仕訳として扱う。
以下のフィールド表は実装時の設計予約。

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

### businesses/{businessId}/recurringTemplates/{templateId}

定期取引テンプレート。「今月分を生成」操作で指定月の取引(draft)を一括作成する。
生成済み管理は `lastGeneratedMonth` で行い、同じ月の再生成はしない。

| Field | Type | Note |
|---|---|---|
| name | string | テンプレート名 |
| type | string | `income` / `expense` / `transfer` |
| account | string | 勘定科目コード |
| counterparty | string | 取引先名 |
| description | string | 摘要 |
| amount | number | 円・整数 |
| dayOfMonth | number | 毎月の生成日(1-31)。その月に存在しない日は末日へ調整 |
| active | boolean | 無効化は削除ではなく `false` |
| lastGeneratedMonth | string? | 最後に生成した月(yyyyMM) |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/recurringInvoiceTemplates/{templateId}

定期請求書テンプレート。「今月分を生成」操作で、期日の来たテンプレートから
指定月の請求書(`status=draft`)を一括作成する。生成物は `invoices` で、
請求書番号は既存の連番(`businesses.invoiceCounter`)から採番する。
スケジュールは `startDate` の月を起点に `intervalMonths` ごとの月の
`dayOfMonth` 日(その月に存在しない日は末日へ調整)を発行日とし、
`endDate`・`maxOccurrences` で終了条件を指定する。
生成済み管理は `lastGeneratedMonth`・`generatedCount` で行い、
同じ月の再生成はしない。生成される請求書IDは
`recurring-invoice-{templateId}-{yyyyMM}` で決定的。

| Field | Type | Note |
|---|---|---|
| name | string | テンプレート名 |
| customerId | string | 請求先顧客 |
| projectId | string? | 紐付く案件 |
| items | array | invoicesと同形式 [{ description, quantity, unitPrice, amount, taxRate, taxAmount }]。登録時に正規化済み |
| intervalMonths | number | 生成間隔(月・1-36)。1=毎月、3=3か月ごと、12=毎年 |
| dayOfMonth | number | 各生成月の発行日(1-31)。その月に存在しない日は末日へ調整 |
| startDate | string | YYYY-MM-DD。この日以降の発行日のみ生成対象 |
| endDate | string? | YYYY-MM-DD。この日を超える発行日は生成しない |
| maxOccurrences | number? | 生成回数の上限(1-999)。generatedCountが達したら生成しない |
| dueDays | number | 支払期日=発行日+N日後(0-366) |
| active | boolean | 無効化は削除ではなく `false` |
| generatedCount | number | これまでに生成した請求書の累計数 |
| lastGeneratedMonth | string? | 最後に生成処理を行った月(yyyyMM) |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/fixedAssets/{assetId}

固定資産台帳(減価償却資産)。年間償却費・累計償却・帳簿価額は
`domain/depreciation.ts` が取得情報から再計算する(保存しない)。
「当年分を経費計上」で年度末日付の取引(`type=expense`・`account=depreciation`・
`amount=年間償却費×businessRatio`・`id=depreciation-{assetId}-{fiscalYear}`)を
draft で生成し、`lastBookedFiscalYear` で二重計上を防ぐ。

| Field | Type | Note |
|---|---|---|
| name | string | 資産名 |
| acquiredDate | string | 取得日 YYYY-MM-DD |
| acquisitionCost | number | 取得価額(円・整数) |
| usefulLifeYears | number | 耐用年数(年・整数) |
| method | string | `straightLine`(定額法) / `decliningBalance`(定率法200%) |
| businessRatio | number | 事業割合(%・0-100整数)。償却費の経費計上額に適用 |
| status | string | `active` / `disposed` |
| disposedDate | string? | 除却日 YYYY-MM-DD(status=disposed時) |
| lastBookedFiscalYear | number? | 最後に償却費を計上した会計年度(開始年) |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/inventoryItems/{itemId}

棚卸品目マスタ。年度別棚卸カウント(`inventoryCounts`)の明細を構成する。

| Field | Type | Note |
|---|---|---|
| name | string | 品目名 |
| unit | string | 単位(表示用。例: 個/kg/m) |
| standardUnitPrice | number | 標準単価(円・整数・0以上) |
| createdBy | string | uid |
| createdAt | Timestamp | |
| updatedAt | Timestamp | |

### businesses/{businessId}/inventoryCounts/fy{fiscalYear}

会計年度ごとの期末棚卸カウント(1事業1年度1ドキュメント)。
ドキュメントIDは `fy{fiscalYear}`(fiscalPeriodsと同じ採番)で、
Security Rules側で `docId == "fy" + fiscalYear` を強制する。
期末棚卸高は `lines` の 数量×評価単価 の合計として計算するため
ドキュメントには保存しない(円・整数)。決算書の「期末商品棚卸高」
(対象年度)と「期首商品棚卸高」(翌年度)の初期値として参照される。
締め済み会計年度のカウントは Security Rules でも変更・削除を拒否する。

| Field | Type | Note |
|---|---|---|
| fiscalYear | number | 対象会計年度(docIdの `fy{year}` と一致) |
| lines | array | 明細行(最大500件・同一itemIdの重複は不可) |
| lines[].itemId | string | inventoryItems のID(明細登録時点のスナップショット) |
| lines[].name | string | 品目名スナップショット(品目削除後も帳票表示用に保持) |
| lines[].unit | string | 単位スナップショット |
| lines[].quantity | number | 数量(0以上・小数可。kg/m等の端数に対応) |
| lines[].unitPrice | number | 評価単価(円・整数・0以上。保存時に標準単価で解決済み) |
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

※ 現状このコレクションへの書き込み経路は未実装(Security Rulesと
バックアップ対象の定義のみ)。締めチェックは `closingChecklist`
(services/periods.ts)が期間のデータから都度計算して返す。

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
| action | string | `create` / `update` / `delete` / `close` / `run_ai` / `approve_ai` / `reject_ai` / `import` |
| targetPath | string | 対象ドキュメントのパス |
| createdAt | Timestamp | |

※ 個人情報・証憑内容のスナップショットは保存しない。対象の識別情報のみ記録する。
AI関連のactionは `run_ai` / `approve_ai` / `reject_ai` を使う。
CSVインポート実行は `import` を使い、targetPath は実コレクションを持たない
`businesses/{businessId}/imports/{kind}:{登録件数}` 形式の擬似パス
(kind は `bank-csv` / `transactions-csv`)。ファイル名・明細内容は記録しない。

※ `transactions`/`receipts` の `aiSuggestion` mapフィールドは廃止済み(ADR-0005)。
AI提案はすべて `aiSuggestions` コレクションで管理する。

### businesses/{businessId}/aiSuggestions/{suggestionId}

AI提案のライフサイクルを管理するコレクション(ADR-0005)。
`aiSuggestion` mapフィールドの代わりに、状態遷移・再実行・監査を可能にするため独立したドキュメントとする。
書き込みはサーバーサイド(Admin SDK)のみ。

| Field | Type | Note |
|---|---|---|
| businessId | string | 所属事業ID(パスに含まれるがドキュメントにも保持) |
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
