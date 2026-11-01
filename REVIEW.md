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

## 2026-11-02: 期首残高/繰越設定(Issue #49)
- Worktree: opening-balance
### 実装内容
年度ごとの期首残高を business ドキュメントに登録し、総勘定元帳の繰越行・試算表へ反映する機能。依存追加なし。
- `src/lib/accounting/types.ts`: `OpeningBalance` 型(`{ fiscalYear, accountCode, amount }`。amountは円・整数・借方残高を正とする)と `Business.openingBalances?` を追加。rules変更不要(Admin SDK経由の書き込みのため)
- `src/lib/accounting/domain/ledger.ts`: `OPENING_EQUITY_ACCOUNT = "opening_equity"`(元入金=資本の内部コード)と `openingBalanceJournalEntries(balances, fiscalYear, date)` を追加。各残高を元入金相手の貸借一致した仮想仕訳へ展開(正=借方科目/貸元入金、負=逆)。既存関数のシグネチャは変更せず、仕訳列への連結方式としたため後方互換・貸借一致ともに担保
- `src/lib/validation/schemas.ts`: `openingBalancesSchema`(要素検証+年度・科目重複拒否+500件上限。金額は負数許容=貸方残高)
- `src/lib/actions/opening-balances.ts`(新規): `getOpeningBalances`(viewer)・`saveOpeningBalances`(owner・配列全体を置換保存・auditLogs付き)。締め済み会計年度に属するレコードは現状と完全一致しない限り `PERIOD_CLOSED` で拒否(締め済み期間の直接変更禁止ルール)
- `src/lib/opening-balance-accounts.ts`(新規): 期首残高の科目選択肢(現金=cash・預金=deposits・売掛金=receivables。accounts.ts の科目マスタは触らない制約のため別管理)+元入金のラベル解決 `openingAccountLabel`
- `src/app/(app)/reports/actions.ts`: 元帳・試算表の両レポートで `openingEntriesFor()`(表示月を含む会計年度の残高を前年度末付の仮想仕訳化)を仕訳列へ連結。前年度末付としたため当年度どの月でも明細行ではなく繰越残高側へ集約される
- `src/app/(app)/reports/account-label.ts`: `bookAccountLabel` に期首残高関連コード(cash/deposits/receivables/opening_equity)のラベルを追加
- `src/app/(app)/opening-balances/`(新規): 年度ごとの期首残高登録・編集画面。プリセット資産科目+「その他(コード入力)」のカスタム科目対応、行追加/削除、ownerのみ編集可(viewer/editorは読み取り表)
- `src/components/app-shell.tsx`: ナビに「期首残高」1行追加(決算チェックと設定の間)
- `src/lib/accounting/domain/ledger.test.ts`: ドメイン拡張のテスト10件追加(符号による貸借転換、年度/0円/空コードのフィルタ、繰越集約、TB貸借一致)
- `docs/FIRESTORE_SCHEMA.md`: businesses の `openingBalances` フィールド追記
### 実行したテスト
- `pnpm install --frozen-lockfile` — 成功
- `pnpm exec next typegen` — 成功(LayoutProps等の生成型が無いとtypecheckが落ちるため)
- `pnpm lint` — 合格(warning 1件: 既存の `<img>` のみ)
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(29ファイル374件、skip 10)
- `pnpm build` — 合格(`/opening-balances` が静的ルートとして登録)
- Emulator系はIssue制約により未実行
### 備考・次の担当者への注意事項
- 期首残高の転記日は「前会計年度の末日」。会計年度開始月が4月等でも当年度の全月で繰越側に集約される。前期最終月の元帳に「期首残高」行として現れることはない(表示月のFYでフィルタするため)
- 試算表は月内取引+期首残高のみの合計。月初以前の期中取引は含めない既存仕様のまま(残高試算表への拡張は別課題)
- 保存は owner のみ(`updateBusinessSettings` と同じ権限)。editorに開放する場合は `requireEditor` へ変更
- 締め済み年度の編集はサーバー側で拒否するが、UI側では年度を選べてしまう。FiscalPeriod一覧を取って該当年度を非活性にする改善余地あり
## 2026-11-02: 監査ログ閲覧UI(Issue #48)
- Worktree: audit-log-ui
`businesses/{businessId}/auditLogs` を一覧表示する `/audit-log` 画面を新設。viewer以上・読み取り専用(編集操作なし)。依存追加なし。
- `src/lib/audit-log-view.ts`(新規): 表示・絞り込みの純粋関数
  - `parseAuditTargetPath`: `businesses/{bid}/{collection}/{docId}` を分解(事業ルートはcollection="businesses"、ネストパスは先頭サブコレクション+残り、解釈不可はundefined)
  - `AUDIT_TARGET_TYPES` / `AUDIT_ACTIONS`: 対象種別・操作の日本語ラベル(フィルタ選択肢順を兼ねる)。actionはスキーマ上の4種に加え、実データで使われる `run_ai` / `approve_ai` / `reject_ai`(ai/service.tsのappendAudit経由)も定義
  - `describeAuditEntry`: 「差分概要」列。監査ログはスナップショットを保存しない設計(docs/SECURITY_RULES.md)のため、targetPathの対象ラベル+操作から説明文を生成(例:「取引を更新」「会計期間を締め」「AI提案を承認」)
  - `filterAuditLogs`: action完全一致・targetPathのコレクション部・createdAt期間(ISO瞬時・両端含む)で絞り込み、createdAt降順(同時刻はid降順)にソート
- `src/lib/api/queries.ts`: `listAuditLogsRaw`追加(一覧クエリ集約方針に従う)。`.add()`で書かれたログはidフィールドを持たないためdoc.idを補完
- `src/lib/actions/audit-logs.ts`(新規): `listAuditLogs(businessId)` Server Action。`requireViewer`で認可後、ログ一覧と`listMembers`を並列取得し`actorName`(displayName||email)を解決。名前解決失敗時もログは返す
- `src/app/(app)/audit-log/`: `page.tsx`(既存ページと同じSuspense+`instant=false`パターン)と`audit-log-screen.tsx`
  - 表示: 日時(formatDateTime)・ユーザー(名前。未解決はuid先頭8文字+titleにuid)・操作(Badge色分け)・対象種別・対象ID(titleにtargetPath)・概要
  - フィルタ: 期間(開始日・終了日をローカルTZでISO瞬時に変換)・操作種別・対象種別。いずれもクライアント側で`filterAuditLogs`に適用
  - ページング: 最新50件ずつ「さらに読み込み」(取得済みリストを表示側でスライス。フィルタ変更時は先頭に戻す)
- `src/components/app-shell.tsx`: ナビに「監査ログ」追加(決算チェックと設定の間)
- `src/lib/audit-log-view.test.ts`(新規): パース・ラベル・概要生成・絞り込み+ソートの単体テスト
- `pnpm exec next typegen` — 成功
- `pnpm lint` — 合格(warning 1件: 既存のreceipts-screen `<img>`)
- `pnpm test` — 合格(30ファイル379件、skip 10)
- `pnpm build` — 合格(`/audit-log` が静的ルートとして登録)
- Firebase Emulator tests — 該当なし(firestore.rules変更なし)
### 未解決事項・次の担当者への注意事項
- 監査ログのスキーマは識別情報のみ(targetPath+action)で差分スナップショットを持たない。「差分概要」は対象種別+操作の説明文であり、変更内容の差分そのものではない(スナップショット保存はSECURITY_RULESの方針と相談)
- 一覧はコレクション全件取得→メモリ絞込(既存のlist系と同方針)。auditLogsが肥大化した場合は`firestore.indexes.json`既存の(targetPath ASC, createdAt DESC)索引を使ったサーバーサイドページングへの移行を検討(action絞り込みには別途索引が必要)
- `action`フィールドのTS型(`AuditAction`)は4種だが実データにはAI系3種も混在する。画面はstring扱いで未知値をそのまま表示する
- `writeAuditLog`/`appendAuditLog`経由のエントリはdocに`id`フィールドを持たず、`createdAt`欠損時は空文字フォールバック(表示上は空欄)

## 2026-11-02: 領収書OCRの画面配線(Issue #30)
- Worktree: ocr-ui
### 実装内容
Issue #21 のOCR基盤(`AI_OCR_PROVIDER=openai|none`)を画面へ接続した。依存追加なし。
- `src/lib/ai/receipt-ocr.ts`(出口のみ変更): `isReceiptOcrAvailable(env)`(`createReceiptOcr()!==null` と同判定だがクライアント構築・警告出力なし。UIの有効判定用)と `isOcrSupportedMimeType(mime)` を公開
- `src/app/api/ai/receipt-ocr/route.ts` 新規: `/api/ai/suggestions` のRoute Handlerパターン踏襲(requireViewer・ApiError・businessId検証・`{ok,data|error}`エンベロープ)
  - `GET ?businessId=` → `{ available }`。OCR設定可否のみ返す(鍵・内容は含まない)
  - `POST { businessId, receiptId }` → businessId内のreceiptを解決し(storagePathはクライアントから受け取らず登録済みレコード由来のみ。他businessIdはNOT_FOUND)、`ReceiptOcrResolver` で Storage取得→OCR→receipt_extraction を実行し `{ amount, date, vendor, confidence, reason, issues }` を返す。60秒総合タイムアウト
  - aiSuggestionsドキュメントは作成しない読み取り系(フォーム自動入力専用)。OCR未設定は `error.code="OCR_UNAVAILABLE"`、非対応MIME/ファイル未取得/サイズ超過/タイムアウト等は固定文言へ正規化(OCRテキスト・SDKエラーを返さない・ログにも出さない)
- `src/lib/api-client.ts`: `ReceiptOcrResult`・`fetchReceiptOcrAvailability`・`runReceiptOcr`
- `src/app/(app)/receipts/receipts-screen.tsx`:
  - 「領収書から登録」フォーム(日付/金額/勘定科目/取引先/摘要)。`transactionSchema`で検証し、`createTransaction`(支出・下書き)→`linkReceipt`で紐付けまで行う。確定は必ずユーザーの保存操作
  - 「OCRで自動入力」ボタン(unprocessed・editor以上): POST `/api/ai/receipt-ocr` の抽出値でフォームをプリフィル。`issues`があれば警告で明示し確認を促す
  - OCR未設定時(`available=false`・問い合わせ失敗も同扱い)はボタンを無効化し「OCRが未設定…」を明示。失敗しても領収書機能自体は止めない
  - 証憑抽出提案の採用 → `decideAiSuggestion` 後に抽出値を登録フォームへコピー(保存は別操作)。紐付先取引宛の提案(科目・摘要)は採用時に `updateTransaction` で確定フィールドへ反映(ADR-0005の2ステップ)
  - linked状態の行に「科目をAI提案」(`runAiSuggestion`の`account_suggestion`。抽出/登録済み取引の値をinputに使用)
  - 取引宛提案も `targetType:"transaction"` で取得し、紐付先idで行に表示(証憑宛と併せて新しい順)
### 実行したテスト
- `pnpm install --frozen-lockfile` — 成功
- `pnpm exec next typegen` — 成功
- `pnpm lint` — 合格(warning 1件: 既存の `<img>`)
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(24ファイル300件、skip 10)
- `pnpm build` — 合格(`/api/ai/receipt-ocr` が動的ルートとして登録)
### 未解決事項・次の担当者への注意事項
- OCR実行経路は提案ドキュメントを作成しないため `run_ai` 監査も残らない。監査が必要なら既存 `POST /api/ai/suggestions`(kind=receipt_extraction)経由にするか、本ルートでもauditLogsを書く検討が必要
- OCR route はIssue指定どおり `requireViewer`(書き込みなしの読み取り系)。外部APIコストの乱用が懸念される場合は `requireEditor` への引き上げを検討
- 「領収書から登録」は createTransaction→linkReceipt の2リクエスト。link失敗時は孤立した下書き取引が残る(取引一覧から紐付/削除で回収可能)
- HEIC/HEIFはアップロード可能だがOCR非対応のまま(事前にINVALID_INPUTで案内。Issue #21と同じ制約)
- 抽出フローの型は `ReceiptExtractionPayload` をそのまま利用。`ReceiptOcrResult` は自信度・根拠・issuesを追加した応答shape(api-client.ts)
## 2026-11-02: 取引のCSVエクスポート/インポート(Issue #31)
- Worktree: csv-io
取引一覧画面へのCSV出力・CSV取込機能。依存追加なしの自前CSV実装。
- `src/lib/csv.ts`(新規): 汎用CSV部と取引マッピング部
  - `serializeCsv`: RFC 4180 系(`,` `"` 改行をクォート、`"`→`""`、行末CRLF)
  - `parseCsv`: クォート内改行・`""`・CRLF/LF/CR受理、先頭BOM除去、末尾改行で空行を作らない
  - `decodeCsvBytes`: BOM検出(UTF-8/UTF-16LE/BE)+ UTF-8厳格デコード失敗時のShift_JISフォールバック(TextDecoder標準機能)
  - 取引向け: `TRANSACTION_CSV_HEADER`(日付/種別/科目コード/科目名/取引先/摘要/金額/状態)、`buildTransactionsCsv`、`transactionToCsvRow`、`parseTransactionsCsv`
  - インポート検証: 先頭行に既知列名が2つ以上あればヘッダーとして列名で対応付け(列順入れ替え・余分列を許容、必須は日付/種別/科目コード/金額)。なければエクスポート列順で位置読み。行ごとにエラー配列+`TransactionInput`を返す。科目コードはACCOUNT_OPTIONS照合、日付は`dateString`スキーマ、金額は全角数字・円記号・桁区切りを正規化して正の整数円のみ。最終確認としてサーバーと同一の`transactionSchema`で再検証
- `src/app/(app)/transactions/transaction-csv-import.tsx`(新規): ファイル選択→パース→プレビュー表(行番号・解釈値・行別エラー)→「N件を登録」で行ごとに `createTransaction` を逐次呼ぶ取込パネル。エラー行は登録対象から自動除外。行ごとに `crypto.randomUUID()` の冪等キーを確定時点で採番し、失敗行の再登録・通信断での重複を防ぐ。登録済み行は対象外なので部分失敗後の再実行が安全。Shift_JIS等で読んだ場合はファイル名にエンコーディングを表示
- `transactions-screen.tsx`: PageHeaderに「CSV出力」(全ロール、表示中の月範囲をBOM付UTF-8で `transactions-YYYYMM.csv` ダウンロード)と「CSV取込」ボタン(canEdit=viewer以外のみ)を追加。0件月はヘッダーのみ出力=取込テンプレートとしても使える
- `src/lib/csv.test.ts`(新規): 26件。生成/パース/ラウンドトリップ、BOM・UTF-16・Shift_JIS検出、エクスポート列・ラベル、ヘッダー名マッピング、行別バリデーションエラー、空行/列不足/必須列欠如
- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm test` — 合格(25ファイル324件、skip 10)
- `pnpm build` — 合格
- インポート登録はクライアントから行ごとに `createTransaction` を逐次呼ぶ方式(既存経路踏襲)。締め期間違反等のサーバー側エラーは行単位で「失敗」として残り、再登録ボタンでリトライ可能(冪等キーは行ごとに固定済み)。全行を1トランザクションにするバルクAPIは要件外のため未実装
- 取込は常に draft 作成のため CSV の「状態」列は読まない。「科目名」列も参照せず科目コードが正(科目名と不一致でも警告は出さない)
- Shift_JIS判定は「UTF-8厳格デコード失敗→Shift_JIS」のヒューリスティック。SJISとしても不正なバイト列は U+FFFD になる(行エラーとして可視化される)
- エクスポートは画面の種別/状態フィルタに関わらず表示月範囲の全取引を出力する(「月範囲の取引」の解釈)
- `pnpm test:rules` / `pnpm test:emulators` / E2E は未実施(firestore.rules・storage.rules への変更なし、UI新規要素のE2E未カバーは既存画面と同じ扱い)
## 2026-11-02: 仕訳帳・総勘定元帳・試算表レポート(Issue #32)
- Worktree: ledger-reports
- `src/lib/accounting/domain/ledger.ts`(新規): 帳簿ロジック。Transaction(1行=type+account+amount)を複式仕訳へ展開する
  - `transactionToJournalEntry`: income=借方現金/貸方科目、expense=借方科目/貸方現金、transfer=借方科目(振替先)/貸方現金(振替元)。`CASH_ACCOUNT="cash"` を相手科目に使う
  - `buildJournal`: 確定済み(confirmed/locked)のみ日付昇順。draftは月次集計と同様に除外
  - `buildAccountLedger`: 科目別に繰越残高(期間開始前の転記)+明細行+残高推移。残高方向は全期間の貸借合計が大きい側(勘定体系マスタが無いため)
  - `buildTrialBalance`: 科目別借方/貸方合計・残高、合計行と貸借一致フラグ
- `src/app/(app)/reports/actions.ts`(新規・"use server"): `getJournalReport`/`getAccountLedgerReport`/`getTrialBalanceReport`。`requireViewer`+`getStore().listTransactionsInRange`+domain関数の月次レポート同型。集計は保存しない。変更範囲の制約上 `src/lib/actions/` ではなく reports/ 配下に配置
- 新規ページ: `reports/journal`(仕訳帳: 日付/借方科目/借方金額/貸方科目/貸方金額/摘要)、`reports/ledger`(総勘定元帳: 科目選択+繰越・期末残高+明細)、`reports/trial-balance`(試算表: 科目別貸借合計+合計行+貸借一致バッジ)。`useApiData`/`callApi`/`MonthNav` の既存パターン踏襲
- `src/app/(app)/reports/account-label.ts`(新規): 帳簿用科目ラベル。`cash` は科目マスタ(accounts.ts)未登録の内部コードのため「現金」をここで補う
- `src/components/app-shell.tsx`: ナビに仕訳帳/総勘定元帳/試算表を月次レポートの直下に追加
### 設計上の判断
- **transfer の仕訳展開**: Transaction は相手科目を持たない(1科目のみ)ため、「借方=account(振替先)/貸方=現金(振替元)」の一方向として展開。収支と同じ「現金相手」モデルに揃え、Issue記載の「借方=振替先/貸方=振替元」に現金=振替元を当てはめた。振替は収支を構成しない点は月次集計(transferを収支に含めない)と同じ扱い
- **元帳の残高方向**: 勘定体系に借方/貸方の性質マスタが無いため、全期間の貸借合計が大きい側を残高方向とするヒューリスティック(収益科目→貸方、費用・現金→借方が普通になる)
- **総勘定元帳のデータ範囲**: 繰越残高のため `0001-01-01`〜月末の全取引を読む(dashboardのallTxと同じ手法)
- `pnpm install --frozen-lockfile` — 合格
- `pnpm exec next typegen` + `pnpm typecheck` — 合格
- `pnpm test` — 合格(25ファイル315件、skip 10。`domain/ledger.test.ts` 新規17件含む)
- `pnpm build` — 合格(3新規ルートを含む全ルート生成)
- Firebase Emulator tests — 未実施(rules・サーバー書き込み経路の変更なし。Emulator同時起動制約のため起動せず)
- `domain/`(旧世代)と`services/`(新世代)の2系統併存のため、domain関数の入力は `Pick<TransactionEntity>` 型(`JournalTransaction`)として services 側 `Transaction` をそのまま受け取れるようにした。Entity型の統合整理は従前どおり別タスク
- `cash` 勘定は科目マスタ(accounts.ts)に無いため帳簿画面側で「現金」ラベルを補っている。正式な科目体系の整備時にマスタ側へ移す余地あり
- 振替の逆方向(他口座→現金)は現モデルでは表現できない。相手科目フィールドが将来追加された場合は `transactionToJournalEntry` の展開を見直すこと
- E2E(`pnpm test:e2e`)は未実施。帳簿画面のE2Eカバレッジは別タスク
## 2026-11-02: UX/アクセシビリティ仕上げ(Issue #35)
- Worktree: ux-a11y
- 変更内容: ui.tsx プリミティブのアクセシビリティ強化と、対象画面のフォームエラー inline 化・モバイル用テーブル overflow 対応
- 変更ファイル:
  - `src/components/ui.tsx`
    - `Button`: focus-visible アウトライン、disabled 時の `aria-disabled` + `disabled:opacity-60` で視覚統一、loading 時 `aria-busy`
    - `Field`: `<label>` 包み込みから `<label htmlFor>` + 子コントロールへの `useId` ベース id 注入へ変更。error 時 `aria-invalid`、error/hint を `aria-describedby` で参照(子が既に id/aria-describedby を持つ場合は尊重・連結)
    - `inputClass` 系(TextInput/NumberInput/Select/Textarea): disabled 視覚 + `aria-invalid:` 時の赤枠/赤リング。`FileInput` に focus-visible アウトライン + disabled 視覚
    - `issuesByField` 新設: `parseForm` の issues("path: message")をフィールドマップへ変換(パス無しは `_form`)
    - `ConfirmDialog`: `aria-label` → `aria-labelledby`(見出し参照)に変更、開時にキャンセルボタンへ autoFocus
    - `tableClass`: `th` を whitespace-nowrap に
  - `src/app/login/login-screen.tsx`: email/password をフィールド下エラー化(認証エラーは Alert 維持)、モード切替に `aria-pressed` + focus-visible
  - `src/app/(app)/settings/settings-screen.tsx`: 事業情報/新規事業/メンバー招待フォームをフィールド下エラー化、members テーブルに overflow-x-auto、ロール変更 Select に aria-label
  - `src/app/(app)/customers/customers-screen.tsx`、`projects/projects-screen.tsx`、`expenses/new/expenses-screen.tsx`: 各登録/編集フォームをフィールド下エラー化(projects 編集時の手動チェックも fieldErrors に統一)
  - `src/app/(app)/dashboard/dashboard-screen.tsx`: 最近の取引テーブルを overflow-x-auto 化、要対応リンクに focus-visible アウトライン
  - `src/app/(app)/closing/closing-screen.tsx`: チェックリスト5テーブルを overflow-x-auto 化
  - `src/components/ui.test.tsx` 新規: Field の htmlFor 関連付け/aria-invalid/aria-describedby/hint/既存 id 尊重 + issuesByField を6件検証
- Checks:
  - `pnpm install --frozen-lockfile` — 成功
  - `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存・対象外ファイル)
  - `pnpm exec next typegen` / `pnpm typecheck` — 合格
  - `pnpm test` — 合格(25ファイル304件、skip 10)
  - `pnpm build` — 合格
- 備考:
  - 破壊的操作の ConfirmDialog は対象画面では既に徹底済み(settings メンバー削除、closing 期間締め)のため変更不要。expenses の「支払済にする」はデータ喪失を伴わない状態更新のため確認ダイアログ対象外と判断
  - `Field` の子は全箇所で単一コントロールのため cloneElement 注入で問題なし。app-shell/transactions 等の対象外ファイルからも同じ Field を利用しており、そちらにも htmlFor 関連付けが波及(ファイル自体は未変更)
  - `formIssuesMessage` は対象外ファイル(app-shell/transaction-form/invoices-screen)が現役利用のため export を維持
  - `aria-disabled` はネイティブ `disabled` と併記(冗長だが issue 要件・一貫性のため)。loading 中は disabled と併せて付与
  - Emulator 系チェック(test:rules/test:emulators)は本タスクの指定チェック範囲外のため未実施
## 2026-11-02: 本番ハードニング(Issue #34)
- Worktree: prod-hardening
- `src/lib/env.ts`(新規): 起動時env検証。必須 `NEXT_PUBLIC_FIREBASE_*` が
  空なら `EnvValidationError`(不足キー名を列挙した明確なメッセージ)。
  本番(`NEXT_PUBLIC_USE_FIREBASE_EMULATOR!=true`)で Emulator host 環境変数が
  残っていたら console.warn で警告(起動は継続)。
  `src/lib/firebase/client.ts` の `getFirebaseApp()` から
  `assertFirebaseClientEnvOnce()` として呼ぶ(検証は1回のみ・失敗時はメモ化しない)
- エラー境界: `src/app/error.tsx` / `src/app/not-found.tsx` /
  `src/app/global-error.tsx` を新設(日本語メッセージ・再試行導線)。
  既存 `src/app/(app)/error.tsx` を拡張(console.error による診断ログ・
  本番サーバーエラーの digest 表示・ダッシュボードへの復帰導線)
- `/api/ai/*` への簡易レート制限: `src/lib/api/rate-limit.ts`(新規)。
  インメモリ Map の固定ウィンドウ方式・businessId単位
  (サーバーレスではインスタンス単位の最良努力とコメント明記)。
  提案生成 POST=60回/時、一覧 GET・承認/却下 PATCH=240回/時。
  超過時は `RateLimitError`→HTTP 429 + `{ok:false,error:{code:"RATE_LIMITED"}}` + Retry-After ヘッダ
- APIエラーレスポンス統一: `toErrorResponse()` を `src/lib/api/result.ts` に追加し、
  全 Route Handler(api/ai/*・api/receipts/*・api/session)で共用する形に整理。
  `/api/session` は `error` が文字列だった非準拠レスポンスを `{code,message}` 形式に修正。
  あわせて INTERNAL を 400→500 に修正、receipts POST で NOT_FOUND→404 が抜けていたのを統一
- `ApiError.code` に `RATE_LIMITED` を追加
- README: 前提(Node 26+/pnpm/JDK 21+)/環境変数・Emulator セットアップ/
  コマンド一覧(test:rules・test:emulators 追記)/本番 Firebase 切替手順/
  デプロイ指針を整備。.env.example の変数一覧と整合
- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm install --frozen-lockfile` — 成功
- `pnpm exec next typegen` — 成功
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(26ファイル314件、skip 10。env.test.ts 11件・rate-limit.test.ts 5件を新規追加)
- `pnpm build` — 成功
- Emulator・`next dev` は制約により未起動(Rules/E2E テストは未実施)

## 2026-11-02: AI提案のUI接続(Issue #20)

- Worktree: ai-ui-integration

### 実装内容

PR #17 で配線済みの REST API(`/api/ai/suggestions`)と画面を接続した。
クライアントは fetch のみで Route Handler 経由(aiSuggestions コレクションへの直接アクセスなし)。

- `src/lib/api-client.ts`: `apiFetch` を追加。`{ ok, data|error }` レスポンスを `callApi` と同じ規約(ApiClientError・UNAUTHORIZED 時のセッション張り直し+1回リトライ)で処理する JSON fetch ラッパー
- `src/lib/ai/types.ts`: `AISuggestionDTO` を追加。`Response.json` で Date が ISO 文字列化されるため、wire 用に日時フィールドを string に置き換えた型
- `src/lib/ai/client.ts`(新規): `listAISuggestions`(GET) / `runAISuggestion`(POST) / `decideAISuggestion`(PATCH) の型付き fetch ヘルパー
- `src/lib/hooks/use-ai-suggestions.ts`(新規): 対象(type+id,任意でkind)に紐づく提案一覧を `useApiData` で取得するフック
- `src/components/ai-suggestions.tsx`(新規): 提案ドキュメント用 `AISuggestionCard`。kind別payload表示(科目候補/摘要/重複候補/月次説明/証憑抽出フィールド)・状態バッジ・信頼度・根拠・採否ボタン。適用可能なkind(account_suggestion/transaction_description)は `onApply` で確定フィールドへの反映を呼び、情報表示系は「確認済みにする」で解決。needs_review(失敗)は警告+却下のみ
- `src/app/(app)/transactions/transaction-ai-panel.tsx`(新規): 取引の展開行内に「AIアシスタント」パネル。`科目を提案`/`摘要を提案`/`重複チェック` の生成ボタン + その取引への提案一覧。receipt_extraction はOCR基盤が別タスクのため対象外
  - 採用フロー(ADR-0005の2ステップ): 「この科目を採用」等 → `updateTransaction` で確定フィールドへコピー → `decideAISuggestion` で提案を accepted に解決。反映に失敗した場合は提案を未解決のまま残す。取引 status は変わらず draft/confirmed のまま(確定は confirmTransaction のみ)
  - 重複チェックは一覧読込済みの同月取引を `existingTransactions` として照合・候補表示に使用
- `src/app/(app)/reports/monthly/monthly-ai-explanation.tsx`(新規): 月次レポートに「AIによる月次の説明」カード。`monthly_explanation` の生成・表示・採否。表示のみで確定データに影響しない(AI_POLICY)
  - 対象は保存済み monthlySummaries ドキュメントのため `data.persisted` がある場合のみ生成可(未保存時は案内表示)。input は `{ summary: persisted, previousSummary: 前月のpersisted ?? current }`
- ロール制御: 生成/採否ボタンは editor 以上かつ対象が変更可能(取引は locked 以外)のときのみ表示。viewer は一覧閲覧のみ(GETはviewer権限)
- `src/components/ai-suggestions.test.tsx`(新規): カードの kind 別表示・apply/decide コールバック・失敗時のボタン制御を6件検証

### 実行したテスト

- `pnpm install --frozen-lockfile` — 成功
- `pnpm exec next typegen` — 成功
- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(23ファイル278件、skip 10)
- `pnpm build` — 合格

### 未解決事項・次の担当者への注意事項

- 採用=「確定値へ反映→提案をaccepted」は2リクエストのため、反映成功後にPATCHだけ失敗し得る。その場合提案は pending のまま残り、再度採用すれば冪等に解決できる
- needs_review の再実行は「新しい提案をPOST」する方式(retry 用のエンドポイントは無い)。失敗した提案は却下して整理する運用
- duplicate_detection の照合対象は画面に読み込まれた同月取引のみ。月またぎの重複は現状検出しない(必要なら全期間取得に拡張)
- `transactions`/`receipts` の旧 `aiSuggestion` 埋め込みフィールドのUI(既存 AiSuggestionCard)は残置。ADR-0005 では廃止予定だが、既存データ表示の互換維持のため本タスクでは触っていない

## 2026-11-02: AI提案実装の統合(ADR-0005への一本化)

- Worktree: ai-suggestion-consolidation

### 実装内容

`aiSuggestions` コレクションの独立ドキュメント方式(ADR-0005、`src/lib/ai/*`)を正規実装とし、アプリ内の旧実装3系統を削除してUI・ダッシュボード・rules・docsを新shapeへ一本化した。前タスク(ai-api-wiring)が残した「旧 `services/aiSuggestions.ts` 系との統合整理は別タスク」の対応。

- 削除(旧: ドキュメント内 `aiSuggestion` 埋め込みフィールド方式)
  - `src/lib/accounting/services/aiSuggestions.ts`(+test)、`src/lib/accounting/suggestions.ts`、`src/lib/accounting/domain/ai.ts`
  - `AccountingService.saveAiSuggestion/acceptAiSuggestion/rejectAiSuggestion` と関連テスト
  - `src/lib/firebase/server.ts` の `createAiSuggestion`(旧shape・呼び出しなしの死コード)
  - Server Actions `approveTransactionSuggestionAction`/`rejectTransactionSuggestionAction`/`decideReceiptSuggestionAction`
  - `Transaction`/`Receipt`/`TransactionEntity`/`ReceiptEntity` の `aiSuggestion` フィールド、旧 `AiSuggestion`/`AiSuggestionStatus` 型、DomainErrorCode の SUGGESTION_* 4コード
- 追加・変更(新方式への接続)
  - `src/lib/ai/types.ts`: `AISuggestionJSON`(ISO文字列のJSON表現)と `isUnresolvedSuggestion()` を追加
  - `src/lib/ai/apply.ts` 新規: 提案payloadから確定フィールドへのコピー値を組み立てる純粋関数。`account_suggestion`→最高信頼度候補のaccount、`transaction_description`→description のみ。採用(状態解決)とは別のユーザー操作として呼ぶADR-0005の「2ステップ」反映側
  - `src/lib/api-client.ts`: `fetchAiSuggestions`/`runAiSuggestion`/`decideAiSuggestion`(GET/POST/PATCH `/api/ai/suggestions`)
  - `components/ai-suggestion-card.tsx`: 旧 `suggested` map+`approved` 前提から canonical shape(kind別payload・`accepted`/`rejected`/`needs_review`・issues)へ書き換え
  - transactions-screen: 提案をコレクションから取得しtarget.idでグルーピング。「科目をAI提案」で `runAiSuggestion`、採用は `decideAiSuggestion`→別操作で `updateTransaction` にpatch反映(確定ステータスにはしない)、却下は `decideAiSuggestion`。locked取引はpatch非適用
  - receipts-screen: 同様にreceipt対象提案を表示・採否。抽出値の確定データへの自動反映なし(旧UIにも生成トリガーはなかった)
  - dashboard: `getDashboard` が `getAISuggestionService().list` で未解決件数を数え、`pendingSuggestionTransactionIds` で取引行にAIバッジを出す(旧: transaction埋め込み `aiSuggestion.status==="pending"` の件数)
  - `heuristic-provider`: フォールバック科目 `miscellaneous`→`misc_expense`(現行科目コードに合わせる)
- firestore.rules: aiSuggestions update を新shapeに合わせ `pending`/`needs_review`→`accepted`/`rejected` かつ `decidedBy==本人` のみ許可、kind/target/payload等はunaffectedに。`firestore.indexes.json` の旧shape索引2件(targetPath等)を削除
- テスト: `tests/rules` の aiSuggestion fixture・更新テストを新shapeへ(needs_review遷移・解決済み再操作禁止・payload不変)。`src/lib/ai/apply.test.ts` 新規
- docs: FIRESTORE_SCHEMAの旧セクション・データフロー図、SECURITY_RULESの権限表、AI_POLICYのデータ分離節、DECISIONS ADR-0005に実装フィールド名の補足を追記

### ドキュメント互換・移行方針

- 既存Firestoreドキュメントに残っている可能性のある旧 `aiSuggestion` mapフィールドは移行・書き換えを行わない(締め済み含む既存データの直接変更を避ける方針と同じ。invoice-taxの税フィールド対応と同型)
- アプリは型からフィールドを除去済みで読み書きしないため、残存データは無視される。表示・集計・権限判定への影響なし
- `firestore.rules` は `transactions`/`receipts` への `aiSuggestion` 書き込みを引き続き禁止(rulesテストのガードも維持)。除去が必要になった場合はAdmin SDKで対応する
- `aiSuggestions` コレクション側は旧shape(`type`/`targetPath`/`suggestion`)ドキュメントが作成される経路をすべて削除した(rulesでcreate禁止+`createAiSuggestion`削除のため新規混入不可)

### 実行したテスト

- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格(`pnpm exec next typegen` 後)
- `pnpm test` — 合格(22ファイル257件、skip 10)
- `pnpm build` — 合格
- `pnpm test:rules` — 合格(63件。JDK21 `JAVA_HOME=/opt/homebrew/opt/openjdk@21/...` 設定)
- `pnpm test:emulators` — 合格(7件)
- `tests/firestore` — 合格(3件、emulators:exec経由で確認)

### 未解決事項・次の担当者への注意事項

- 提案の採用→反映は非アトミック: `decideAiSuggestion`(accept)後に `updateTransaction` が失敗すると「提案はacceptedだが取引は未反映」になり得る。UIはpatch適用可能な提案の採用ボタンを「提案を採用して反映」と表示し区別しているが、厳密にはサーバー側で「accepted+反映」を1操作にするApply APIの検討余地あり
- `retry`(needs_review再実行)はサービス層のみ実装でAPI未公開のまま。UIからの再実行導線は別タスク
- `monthly_explanation` の表示導線は未実装(kind・payload描画はカード側で対応済み)
- `getDashboard` は `list(limit=MAX_LIST_LIMIT)` で全提案を走査して未解決を数える。store側の走査上限(MAX_LIST_LIMIT)を超える件数では件数が過小になる
- `domain/`(旧世代 `service.ts`/`types.ts`)と `services/`+トップレベル型(新世代)の二重定義は今回の統合対象外。`aiSuggestion` 関連のみ除去し、Entity型等の統合整理は引き続き別タスク
- E2E(`pnpm test:e2e`)は未実施。旧来からAI提案カード操作はE2E未カバー領域で、削除したUIの参照もなかった

## 2026-11-02: 領収書OCR基盤(Issue #21)

- Worktree: receipt-ocr

### 実装内容

receipt_extraction の `input.ocrText` をサーバーサイドで生成する基盤。依存追加なし(既存 openai@7.43.0 を利用)。

- `src/lib/ai/receipt-ocr.ts` 新規:
  - `ReceiptOcr`(証憑ファイル→テキスト抽出の抽象化)と `OcrCaller`(1回のOCR呼び出し。llm-provider.tsの `LLMCaller` と同じ注入パターン)
  - `OpenAIReceiptOcr`: MIMEに応じて画像(JPEG/PNG/WebP/GIF)→`input_image`、PDF→`input_file` のdata URLで Responses API へ送信。HEIC/HEIFはOpenAI非対応のため `provider_error`(画像変換は依存追加になるため対象外)
  - `createOpenAIOcrCaller`: `store: false` 固定・`assertServerSide`・出力は `{"ocrText": "..."}` の構造化JSON(json_schema strict)に限定してパース・返却。非JSON/欠落は `invalid_response` に正規化
  - `createReceiptOcr(env)`: `AI_OCR_PROVIDER=openai` + `OPENAI_API_KEY` 時のみ有効。モデルは `OPENAI_OCR_MODEL` → `OPENAI_MODEL` → DEFAULT。未設定/unknown/鍵欠落は null(OCR無効)でフォールバックし本体機能を妨げない
  - `ReceiptOcrResolver`: AIProviderのデコレータ。receipt_extraction のみ介入し、(1)クライアント指定の ocrText があればそのまま(Emulator/開発用)、(2)未指定なら対象 receipt の `storagePath` からダウンロード→OCR→`input.ocrText` へ注入して inner へ委譲。storagePath は登録済みレコード由来のため任意パス参照は起きない。OCR失敗は service 層で needs_review+retriable として記録される経路
- `src/lib/api/ai.ts`: `getAISuggestionService()` の provider を `ReceiptOcrResolver(inner=createAIProvider(), ocr=createReceiptOcr(), getReceipt=getStore().getReceipt, downloadFile=Admin SDK)` で構成
- `.env.example`: AI関連の環境変数(AI_LLM_PROVIDER/AI_OCR_PROVIDER/OPENAI_API_KEY/OPENAI_MODEL/OPENAI_OCR_MODEL)を追記
- `src/lib/ai/receipt-ocr.test.ts` 新規(@vitest-environment node): ファクトリ分岐、MIME→input種別マッピング、SDKエラーの正規化(証憑内容を含まないこと)、callerの `store:false`・content shape、resolver の委譲/短絡/サイズ上限/404、AISuggestionService 統合(OCR→heuristic→pending提案)

### 実行したテスト

- `pnpm lint` — 合格(warning 1件: 既存の `<img>`)
- `pnpm typecheck` — 合格(要 `pnpm exec next typegen`: LayoutProps は Next 16 生成型で worktree 直後は .next/types が未生成)
- `pnpm test` — 合格(23ファイル292件、skip 10)
- `pnpm build` — 合格
- `pnpm test:rules` — 合格(62件)
- `pnpm test:emulators` — 合格(7件)

### 未解決事項・次の担当者への注意事項

- worktree 作成直後は `pnpm install` だけでなく `pnpm exec next typegen` も必要(typecheck が LayoutProps で落ちる)。AGENTS.md の Environment 節に追記検討
- AI_OCR_PROVIDER 未設定の既定動作: クライアント指定 ocrText 必須のまま(未指定は needs_review)。UI からの OCR 実行導線・新旧2系統の統合は Issue #20/#22 側
- HEIC/HEIF アップロードは現状 OCR 不可(provider_error→needs_review)。対応する場合はアップロード時変換か別OCR系が必要
- `input_file`/`input_image` のモデル対応は gpt-5系前提。OPENAI_OCR_MODEL で変えられるが非対応モデルはAPIエラーになる
## 2026-11-02: 申告レベル消費税計算(Issue #24)

- Worktree: tax-filing-precision

### 実装内容

- `src/lib/accounting/domain/tax.ts` に確定申告レベルの計算を追加(既存公開APIは不変・純粋関数・整数演算のみ・Firebase非依存)。付表1-3/第二表の手順に対応する割戻し方式
  - `computeTaxableBase(amountInclusiveYen, rate)`: 課税資産の譲渡等の対価(税込合計)×100/110(軽減は×100/108)→千円未満切捨て。税率区分ごとに別々に算出
  - `computeConsumptionTaxFiling(mode, amounts, {businessClass})`: 税率別の売上/仕入(税込合計)から申告書相当額を算出
    - 課税標準額に対する消費税額(国税): 標準7.8%・軽減6.24%、1円未満切捨て
    - 控除対象仕入税額(本則課税): 税込支払対価×7.8/110・軽減6.24/108、1円未満切捨て
    - 簡易課税: みなし仕入率を消費税額合計に適用(businessClass必須、他方式は指定拒否。既存APIと同じバリデーション)
    - 差引税額(balance)は百円切捨て前の値で保持。納付側は国税・地方消費税とも百円未満切捨て、還付側は1円精度
    - 地方消費税 = 差引税額(切捨て前)×22/78→百円未満切捨て(譲渡割額は還付税額×22/78・円精度)
    - 戻り値 `ConsumptionTaxFiling`: 税率別内訳(breakdown)、課税標準額/消費税額/控除額/差引/国地別納付額/合計、還付額
  - 同一rateの入力行は合算してから課税標準額を算出(対価の合計額×係数が法定手順)
- `src/lib/accounting/domain/tax.test.ts`: 12件追加(課税標準額の千円切捨て・税率別内訳・合算順序・還付・百円切捨て・地方税の課税標準が切捨て前・簡易課税・免税・バリデーション)

### 設計上の判断

- **国税率は 6.3% ではなく 7.8%/6.24%**: Issue記載の「国税6.3%/地方税2.2%」は2019/9までの旧8%時代の率で、6.3+2.2=8.5%となり標準10%と整合しない。現行の法定率は標準10%=国税7.8%+地方2.2%、軽減8%=国税6.24%+地方1.76%(地方税はいずれも消費税額×22/78)。国税庁タックスアンサーNo.6371・付表1-3記載要領に従い実装
- **地方消費税の課税標準は百円切捨て前の差引税額**: 付表1-3では差引税額⑨(→第一表・百円切捨て)と⑪(→第二表⑳・円精度)が別行で、地方税は⑪×22/78。切捨て後を基礎にすると差が出るケースを専用テストで担保(78,390→22,100。誤実装だと22,000)
- **還付は円精度**: 百円未満切捨ては納付税額のみに適用(通則法の端数処理)。還付税額・譲渡割額は1円精度で返す
- **簡易課税の税率別内訳**: みなし仕入れは消費税額合計への一括適用(申告書の手順)のため、breakdown行の `deductibleInputTax` は0とし合計側のみに値を持たせる
- **exempt**: 納付義務なし。入力バリデーションは実施した上で全額0・breakdown空を返す

### 実行したテスト

- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格(`pnpm exec next typegen` による型生成後)
- `pnpm test` — 合格(22ファイル287件、skip 10)
- `pnpm build` — 合格
- Firebase Emulator tests — 該当なし(rules変更なし、domain層のみ)

### 未解決事項・次の担当者への注意事項

- 中間納付額の相殺(第一表⑫-⑬)・売上対価の返還等/貸倒れ(付表③⑤⑥)・課税売上割合95%未満の個別対応/一括比例配分・2割特例は未対応。確定申告UI接続時に必要に応じて拡張
- 旧税率(3/4/6.3%)適用取引がある課税期間は付表が異なり地方税計算も別式。対象外とした
- 本関数への入力(税率別・税込対価合計の集計)は Transaction/Expense 側に税率区分フィールドを持ち回る必要があり、集計側の実装は別タスク
- `domain/`(旧世代)と`services/`(新世代)の2系統併存・TaxCategory表記不統一は従前どおり別タスク
## 2026-11-02: @types/node を ^20 → ^26 へ更新(Issue #23)

- Worktree: types-node-update

### 実装内容

- `package.json` の devDependencies `@types/node` を `^20` → `^26` へ変更し `pnpm install` で lockfile 更新(解決結果: 26.6.6)。実行環境は `.node-version` = 26(実機 v26.13.0)で型定義とランタイムが一致した
- 型差分による typecheck/test の失敗・コード修正はゼロだった(Node 20→26 の型差分が本コードベースの使用APIに非該当)

### 変更ファイル

- `package.json`: `@types/node` の specifier のみ
- `pnpm-lock.yaml`: `@types/node@20.19.43` → `@types/node@26.6.6`(直接依存 + peer 解決先の next/@vitejs/plugin-react/firebase-tools の参照更新)

### 実行したテスト

- `pnpm install` — 合格
- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格(先に `pnpm exec next typegen` が必要。worktree 初回は `.next/types` 未生成で `LayoutProps` 未解決になる既知の手順)
- `pnpm test` — 合格(22ファイル272件、skip 10)
- `pnpm build` — 合格(全ルート生成)
- Firebase Emulator tests — 未実施(型定義依存の更新のみで rules・サーバーロジックに変更なし)

### 未解決事項・次の担当者への注意事項

- ci-node-version タスク時点の未解決事項「`@types/node` が `^20` のまま」を本タスクで解消済み
- `next typegen` 前に `pnpm typecheck` を実行すると `LayoutProps` 未解決で落ちるのは worktree 初期状態の既知事項であり、@types/node 更新とは無関係(AGENTS.md の環境節にも手順追加候補)

## 2026-11-02: E2Eカバレッジ拡大(未カバー画面・ロール・請求/締めの分岐)

- Worktree: e2e-coverage

### 実装内容

新規 spec 5ファイル(+11件)と既存 spec への追補(+3件)、既存テストの文言ドリフト修正2件。計 31 → 31件合格(新規14件追加、修正2件)。

- `e2e/dashboard.spec.ts`(新規)
  - 空の事業で「未処理の項目はありません」+ 空の最近の取引
  - 下書き登録で要対応「未確定の取引(下書き) 1件」+ 最近の取引に出る → 確定後に月次経費カードへ金額反映・要対応ゼロ復帰
- `e2e/settings.spec.ts`(新規)
  - 事業名・年度開始月の変更がヘッダーの切替コンボへ反映
  - 2つ目の事業作成で自動選択 → 取引一覧が空(businessId ごとのデータ分離を UI レベルで検証)→ 切替で元データ復帰
  - 未登録メールアドレスへの招待はエラー表示
- `e2e/members.spec.ts`(新規・別ブラウザコンテキストで2ユーザー操作)
  - viewer 招待 → メンバー一覧に2行 → 招待側で事業が見え、取引は読めるが登録/編集/確定/期間作成など全操作ボタンが非表示(経費画面は「閲覧ロールのため登録はできません」)
  - メンバー削除 → 相手の事業一覧から消えオンボーディングへ戻る(再ログインでも復活しない)
- `e2e/invoices.spec.ts`(新規)
  - 明細追加で合計が加算される(150,000 + 50,000×2 = ￥250,000)
  - 一部入金で残額減・発行済み維持 → 残額入金で入金済み
  - 残額超過の入金はクライアント側でエラー
  - 支払期日超過の発行済み請求書は一覧再取得で「期限超過」
- `e2e/customers.spec.ts`(新規): 顧客編集の反映、案件の状態変更(進行中→完了)+ 状態フィルタと空メッセージ
- `e2e/transactions.spec.ts` 追補: 必須項目空送信で zod エラー表示(formIssuesMessage 経由)、月送りナビ + 種別フィルタ
- `e2e/closing.spec.ts` 追補: 期日超過の未払経費・未入金請求書が決算チェックの各セクションに「期限超過」バッジ付きで出る

### 既存テストの修正(文言ドリフト)

ui-polish の表記統一(証憑→領収書、紐付け済み→紐付済み)で既存 E2E が2件壊れていたのを修正。当該作業時点で E2E 未実行だったため残存していた。

- `closing.spec.ts`: 「証憑未添付の確定済み経費」→「領収書未添付の確定済み経費」
- `receipts.spec.ts`: 状態フィルタの option ラベル「紐付け済み」→「紐付済み」

### 実行したテスト

- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(20ファイル254件、skip 7)
- `pnpm build` — 合格
- `pnpm test:e2e` — 合格(31件。初回3件失敗→上記ドリフト修正+alert の strict mode 対処で全合格)
- `pnpm test:rules` — 合格(62件)
- `pnpm test:emulators` — 合格(4件)

### 未解決事項・次の担当者への注意事項

- `getByRole("alert")` は Next.js の `#__next-route-announcer__` も拾うため strict mode で複数ヒットする。Alert 検証は `.filter({ hasText: ... })` で絞ること(本 spec 内の書き方を踏襲)
- E2E は表記変更に弱い。画面文言を変えるタスクでは `pnpm test:e2e` まで Required Check に含めた方がよい(今回のドリフトのように vitest/build だけでは検出できない)
- メンバー招待の E2E は Auth Emulator の `getUserByEmail` 依存。招待相手のユーザー作成が先に必要(helpers の `signUp` を別コンテキストの page で呼ぶ形を members.spec.ts 参照)
- 領収書の「取引に紐付ける」UI 内の「紐付ける」ボタン表記は意図的に残っている模様(ui-polish ではバッジ/フィルタのみ統一)

## 2026-11-02: 請求書への消費税エンジン適用(Issue #12)

- Worktree: invoice-tax

### 実装内容

- `src/lib/accounting/invoice-tax.ts` 新規: 請求書用の消費税計算をまとめた純粋関数モジュール。税額算出は `domain/tax`(`computeTaxAmount`/`sumTaxAmounts`、10%/8%・整数円・切り捨て)へ委譲し再実装なし。`invoices-screen.tsx`(フォーム見積・一覧表示)と `services/sales.ts`(登録時の確定値)が同一計算経路を共有する
  - `invoiceItemTaxAmount(item)`: 明細1行の内税。`computeInvoiceTotals(items)`: `{totalAmount, taxAmount}`(明細ごと切り捨て→合算)。`invoiceTaxAmount(invoice)`: 保存済み `taxAmount` 優先、未保存(税フィールド導入前データ)なら明細から導出
  - 金額は税込として扱う(ACCOUNTING_RULES.md「初期版は税込表示を基準にする」)。税率省略時は標準税率10%(`DEFAULT_INVOICE_TAX_RATE`)
- `src/lib/accounting/types.ts`: `InvoiceItem` に `taxRate?: ConsumptionTaxRate`・`taxAmount?`、`Invoice` に `taxAmount?` を追加(いずれもoptionalで後方互換)
- `services/sales.ts`: `validateInvoiceItems` → `normalizeInvoiceItems` へ拡張。税率区分の検証(standard/reduced以外は INVALID_INPUT)・明細ごとの `taxRate`/`taxAmount` 付与・`invoice.taxAmount` 保存。クライアント指定の `item.taxAmount`/`input.taxAmount` は従来の `totalAmount` と同じく再計算値との一致を検証(AMOUNT_MISMATCH)
- `validation/schemas.ts`: `invoiceItemSchema` に `taxRate` optional enum 追加。`actions/sales.ts` は `taxRate` をサービスへ渡すのみ(計算はサービス側)
- `invoices-screen.tsx`: 明細行に税率セレクト(10%/軽減8%)、ローカル reduce 計算を `computeInvoiceTotals` に置換し「合計 ¥X(うち消費税 ¥Y)」を表示。一覧の請求額セルに「うち消費税」行を追加(formatYen/`Amount` 維持、旧データは `invoiceTaxAmount` で導出描画)
- `docs/FIRESTORE_SCHEMA.md`: invoices の items 構造と `taxAmount` フィールドを追記

### 設計上の判断

- 税額の基準は「税込・内税」: `unitPrice`/`amount`/`totalAmount` は税込金額のまま据え置き、`basis: "inclusive"` で内税を取り出す。税抜計上への切替はBusinessの会計方式設定ができた段階で対応
- firestore.rules の `validInvoice` は `items` 構造を検査しないため rules 変更なし。`toStore` が `undefined` を落とすため optional フィールドは新規ドキュメントのみに保存される
- 旧請求書(税フィールドなし)は読み取り時に標準税率として導出表示する。書き換えはしない(締め済み含む既存データの直接変更を避ける)

### 実行したテスト

- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格(`pnpm exec next typegen` 後)
- `pnpm test` — 合格(21ファイル268件、skip 7。invoice-tax.test.ts 新規8件 + sales.test.ts 追加5件)
- `pnpm build` — 合格(全ルート static prerender)
- Firebase Emulator tests — 未実施(rules変更なしのため)

### 未解決事項・次の担当者への注意事項

- `domain/`(旧世代 `service.ts`/`validate.ts`)側の請求書経路は未適用。新世代 `services/` のみ接続した(両世代の統合整理は別タスク)
- 請求書の税額内訳(税率ごとの対象額・税額の適格請求書様式表示)、免税事業者モード時の扱いは未対応
- 明細 `amount` 未達(`quantity`/`unitPrice` のみ)から税額を逆算する経路はなく、amount 確定後に内税を取り出す設計


## 2026-11-02: AI提案パイプラインのAPI配線

- Worktree: ai-api-wiring
- Issue: #11

### 実装内容

- `src/lib/ai`(provider/service/store/schema)を Route Handler 経由でアプリに接続。前タスク(ai-llm-provider)が残した「接続は別タスク」の対応
- `src/app/api/ai/suggestions/route.ts` 新規:
  - `GET` 提案一覧。`targetType`/`targetId`/`kind`/`status`/`limit` で絞込、createdAt降順、viewer以上
  - `POST` 提案実行。`{businessId, kind, target:{type,id}, input?}` を受理、editor以上。kind↔targetType対応と対象のbusinessId内存在を検証してから `AISuggestionService.run` へ。`input` は128KB上限
- `src/app/api/ai/suggestions/[suggestionId]/route.ts` 新規: `PATCH` で `{businessId, decision: accepted|rejected, rejectReason?}` を受理し `service.accept/reject` を呼ぶ。確定データへの反映は行わない(AI_POLICY準拠)。存在しない提案は404、処理済みは400
- `src/lib/api/ai.ts` 新規: `getAISuggestionService()`(FirestoreSuggestionStore + createAIProvider、llm-provider.ts記載の想定構成)と `assertSuggestionTarget()`(kind↔targetType対応+対象ドキュメント存在でbusinessId境界を担保)
- `src/lib/ai/store.ts`: `SuggestionListFilter` 型・`DEFAULT_LIST_LIMIT(50)`/`MAX_LIST_LIMIT(100)`・`list` をインターフェースと InMemory に追加
- `src/lib/ai/firestore-store.ts`: `list` 実装。複合インデックスを増やさないため単一フィールド等価 `where`(targetId→`target.id`、なければstatus)のみ使い、残りの絞込とcreatedAt降順ソートはメモリ。走査は200件打ち切り
- `src/lib/ai/service.ts`: `get`/`list` パススルー追加(Route Handlerがサービス経由で完結するよう)
- `src/lib/ai/types.ts`: `KIND_TARGET_TYPE` 対応表を追加(receipt_extraction→receipt等)
- `src/lib/validation/schemas.ts`: `runSuggestionSchema`/`decideSuggestionSchema`/`listSuggestionQuerySchema` を追加(zod)
- 監査は `AISuggestionService` の `appendAudit`(run_ai/approve_ai/reject_ai)が担保。提案・監査ともにサーバーサイド(Admin SDK)のみで、鍵は非NEXT_PUBLIC環境変数

### 実行したテスト

- `pnpm lint` — 合格(warning 1件は既存 receipts-screen の `<img>`)
- `pnpm typecheck` — 合格(先に `next typegen` 実行)
- `pnpm test` — 合格(21ファイル258件、skip 10。新規 `src/lib/ai/store.test.ts` 4件を含む)
- `pnpm build` — 合格(`/api/ai/suggestions`, `/api/ai/suggestions/[suggestionId]` が dynamic ルートとして認識)
- `pnpm test:emulators` — 合格(2ファイル7件。JDK21 `JAVA_HOME=/opt/homebrew/opt/openjdk@21/...` 設定で実行。新規 `tests/emulator/aiSuggestionStore.test.ts` でFirestore往復・list・businessId境界を検証)

### 未解決事項・次の担当者への注意事項

- `pnpm test:rules` は未実施。実行時点で別worktreeのEmulator(8080/9099/9199/4400)が起動中で、AGENTS.mdの「Emulatorは全worktree通して1系統」制約に従い見送り(rulesに変更なし。過去例では起動中Emulatorへの直接接続で代替可能)
- `retry`(needs_review提案の再実行)はサービス層に実装済みだがAPI未公開(Issueの列挙に無いため)。UI配線時に必要ならPATCHか専用ルートで公開
- rules の aiSuggestions update経路(`resolvedBy`等)は旧フィールド名(`type`/`targetPath`/`suggestion`)前提で、新shape(`kind`/`target`/`payload`/`decidedBy`)ドキュメントには実質機能しない。現状すべての状態解決はPATCH経由(Admin SDK)なので実害なし
- `firestore.indexes.json` の aiSuggestions索引2件は旧shape向け。新実装のlistはorderBy不使用で参照されない(残置で無害)
- `createAiSuggestion`(`src/lib/firebase/server.ts`)は旧shapeで未使用のまま。旧 `src/lib/accounting/services/aiSuggestions.ts` 系(ドキュメント内 `aiSuggestion` フィールド)との統合整理は別タスク
- UI(領収書画面等)からの接続は未着手。本タスクはAPI公開まで
- 提案実行の `input` はクライアント指定。receipt_extraction には `ocrText` が必要(OCR基盤は別タスク)
## 2026-11-02: 死コード削除 `src/lib/firebase/auth.ts`(Issue #13)

- Worktree: dead-code-cleanup

### 実装内容

- `src/lib/firebase/auth.ts`(`signInWithGoogle`/`signInWithEmail`/`signUpWithEmail`/`signOut`/`ensureUserDocument`)を削除。ui-polish で `src/lib/firebase/auth-provider.tsx`・`src/app/auth-status.tsx` が削除された結果、参照ゼロになっていた
- 参照確認: `firebase/auth`・`@/lib/firebase/auth`・`./auth` 相対import・各export関数名を grep。import は npmパッケージ `firebase/auth` へのもののみ(`login-screen.tsx`/`components/auth-provider.tsx`/`client.ts`)、`signOut()` 呼出しは `useApp()` 経由で local 実装を `firebaseSignOut` 直呼びしており、本ファイルへの参照はゼロと確認

### 実行したテスト

- `pnpm install --frozen-lockfile` — 合格
- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格(先に `pnpm exec next typegen` が必要。worktree 初回のみ)
- `pnpm test` — 合格(20ファイル254件、skip 7)
- `pnpm build` — 合格(全ルート prerender)
- Firebase Emulator tests — 未実施(クライアント側死コード削除のみ。Rules・サーバーロジックに変更なし)

### 未解決事項・次の担当者への注意事項

- Googleサインイン(`signInWithPopup`/`GoogleAuthProvider`)や初回 `users/{uid}` 作成(`ensureUserDocument`)は現状どの画面からも呼ばれていない。将来 Google ログインを実装する場合は同等処理の再実装が必要
- REVIEW.md の記法は新しいエントリを `## Log` 直下へ前置する形式のため、末尾ではなく先頭に追記した
## 2026-11-02: CI の Node バージョン修正(20 → 26)

- Worktree: ci-node-version

### 実装内容

- GitHub Actions CI が全ジョブ失敗していた原因を修正。CI が `node-version: 20` 固定だったが、依存が Node 20 非対応:
  - `vitest@5.0.5` — `engines: ^22.12.0 || ^24.0.0 || >=26.0.0` → forks worker が `Cannot read properties of undefined (reading 'bind')` で全テスト起動失敗
  - `firebase-admin@14.5.0` — `engines: >=22` → CI で `firebase-admin/firestore` 由来の型が any 化したと見られる TS7006/TS18046 が typecheck/build 両ジョブで多発(ローカル Node 26 では非再現・メカニズム未確定だが本修正で切り分け)
- `.node-version`(`26`)を新設し `actions/setup-node` の `node-version-file` で参照。ローカル開発の v26 と同一、CI/ローカルの単一ソース化
- `package.json` に `engines.node` を追加し要件を宣言

### 変更ファイル

- `.github/actions/setup-node-pnpm/action.yml`: `node-version: 20` → `node-version-file: .node-version`
- `.node-version`: 新規(26)
- `package.json`: `engines` 追加

### 実行したテスト

- ファイル変更のみ(CI 自体の検証は本PRのチェック実行で確認)
- ローカルで再現確認: `vitest` forks worker が Node 20 で起動不可、`tsc` はローカル(node 26)で全合格

### 未解決事項・次の担当者への注意事項

- `@types/node` が `^20` のまま。`^26` への更新は別タスクで検討(型定義の実害は未確認)
- ローカル開発者の Node が 22.12 未満だと `pnpm install` 時に engines 警告が出る

## 2026-11-02: (app)画面品質の統一 + 認証まわり死コード削除

- Worktree: ui-polish

### 実装内容

- 死コード削除: `src/app/auth-status.tsx`(`AuthStatus`)と `src/lib/firebase/auth-provider.tsx`(`AuthProvider`/`useAuth`)。`AppProvider`(`@/components/auth-provider`)一本化済みで参照ゼロだった
- `src/components/ui.tsx`
  - `ErrorState` の `message` を省略可にし既定文言「データを取得できませんでした」へ統一(dashboard/closing/monthly の3表記揺れを解消)
  - `MonthNav` 追加: 「← 前月 / 翌月 →」ブロックを取引一覧・月次レポートから共通化
  - `FileInput` 追加: 領収書アップロードの素の `<input type=file>` を共通スタイル化
  - `formIssuesMessage` 追加: `parseForm` の issues("path: message"形式)から英語パスを除去し、`items.N.field` は「N行目」に変換。全フォームの `issues.join(" / ")` を置き換え
- フォームバリデーション表示の統一: 全 `<form>` に `noValidate` を付与し、ネイティブのポップアップ(必須・type=email)と zod+Alert の二系統表示を zod+Alert へ一本化。`required` 属性はセマンティクス/a11y用に残しつつ必須項目(顧客名・案件名・事業名・開始月・請求明細など)に補完
- エラー表示の統一
  - 請求書「発行する」がエラー時に無言失敗(unhandled rejection)だったのを `actionError`+Alert 化
  - 入金フォーム・メンバー招待フォームの Alert が flex 行内に潰れて表示されていたのを行下へ移動
  - 経費「支払済にする」に busy 状態を追加し、行操作エラーをフォームエラーと分離(actionError)
- 日本語UIの統一
  - 「証憑」表記を「領収書」へ統一(取引バッジ・決算チェックのセクション名。画面名は領収書確認)
  - 「紐付け済み/紐付済み」→「紐付済み」、「オープン」→「未締め」(期間ステータス)、案件画面の「ステータス」→「状態」、フィルタ先頭項目を「すべての状態」へ統一
  - 空状態を「〜がまだありません」パターンへ統一、フィルタ適用時は「条件に一致する〜がありません」を併用(領収書・案件も対応)
  - 金額の `toLocaleString+"円"` 直書きを `formatYen`("¥12,000"表記)へ統一
  - 領収書の「紐付け先」が取引ID生表示だったのを「日付 / 科目 / 金額」へ解決
  - 取引フォームで現行種別に無い科目コードが英字生表示されるのを `accountLabel` 経由へ
- `src/components/status-badge.tsx`: 期間 `open` のラベル「オープン」→「未締め」

### 実行したテスト

- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格(先に `next typegen` で生成型 `.next/types` を作成。worktree 直後の初回のみ必要)
- `pnpm test` — 合格(18ファイル213件、skip 7)
- `pnpm build` — 合格(全ルート static prerender)
- Firebase Emulator tests — 未実施(rules・サーバー側ロジックに変更なし)

### 未解決事項・次の担当者への注意事項

- `src/lib/firebase/auth.ts` は今回の削除で参照ゼロになったが、スコープ外(src/lib)のため残置。Googleサインイン等で再利用するなら維持、不要なら別タスクで削除候補
- worktree 作成直後は `pnpm install` 後に `pnpm exec next typegen` も必要(`.next` 未生成だと `LayoutProps` 未解決で typecheck が落ちる)
- `Field` コンポーネントの `error` prop は未使用のまま(エラーはフォーム単位の Alert に集約する現行方針を維持)

## 2026-11-02: GitHub Actions CI の構築

- Worktree: ci-setup

### 実装内容

- `.github/workflows/ci.yml`: `push`(main)と `pull_request` で起動。`lint` / `typecheck` / `vitest` / `build` / `test:rules` の5ジョブを並列実行。`permissions: contents: read`、同一 ref の古い実行を `concurrency` でキャンセル
- `.github/actions/setup-node-pnpm/action.yml`: 全ジョブ共通の複合アクション
  - `pnpm/action-setup@v4`(version 未指定 → package.json の `packageManager: pnpm@12.16.1` から解決)
  - `actions/setup-node@v4`(Node 20、`cache: pnpm` で pnpm store をキャッシュ)
  - `pnpm install --frozen-lockfile`
- `typecheck` ジョブ: tsconfig が `.next/types` を include するため `pnpm exec next typegen` で生成型を作ってから `pnpm typecheck`
- `test-rules` ジョブ: `actions/setup-java@v4`(distribution: temurin, java-version: 21)で JDK 21 を導入後、`pnpm test:rules`(devDependency の firebase-tools 経由で `emulators:exec --only firestore,storage`)

### 実行した検証

- `actionlint .github/workflows/ci.yml` — 合格
- YAML パース(ci.yml / action.yml) — 合格
- `pnpm exec next typegen` — 合格(`.next/types` 生成を確認)
- ワークフロー自体の実行は未検証。PR 作成後に GitHub Actions 上で確認すること

### 備考

- 変更は `.github/` 配下のみ。package.json の変更不要(scripts・packageManager は既存のまま利用)
- Emulator JAR(`~/.cache/firebase/emulators`)のキャッシュは未実装。初回実行でダウンロードされるため、起動が遅い場合は `actions/cache` で追加可能
- `test:e2e`(Playwright)は要件外のため未追加。必要なら `playwright install --with-deps` を伴う別ジョブとして追加する

## 2026-11-02: コアフローのE2Eテスト整備

- Worktree: e2e-core-flows

### 実装内容

- `package.json`: `test:e2e` を `firebase emulators:exec --only auth,firestore,storage --project demo-solo-accounting-ai 'playwright test'` に変更。REVIEW_TEST.md T3 対応 — 従来は Emulator 非起動のまま E2E を実行しており、認証・Server Action 経路が未検証だった。Emulator は実行ごとにメモリ上で初期化されるためテストデータは各実行でクリーン
- `playwright.config.ts`: `expect.timeout` を 20s、`actionTimeout` 15s、`navigationTimeout` 45s に設定(dev server の初回 Turbopack コンパイルと Server Action 往復を考慮)
- `e2e/helpers.ts`: E2E共通ヘルパー。`signUp`/`signIn`/`createFirstBusiness`/`signUpAndCreateBusiness`/`signOut`/`createTransactionDraft`/`uniqueEmail`/`datePlusDays`。テスト間の干渉を避けるため、各テストが一意のメールアドレスで新規ユーザーを作成し、専用の事業を作る設計(businessId で自然に分離される)
- `e2e/fixtures/receipt.png`: 領収書アップロード用の 1x1 PNG
- 新規 spec(既存 `home.spec.ts` は維持):
  - `auth.spec.ts`: 新規登録→事業作成→ログアウト→再ログイン(事業引継ぎ)、誤パスワードのエラー表示、未ログイン時の /login リダイレクト
  - `transactions.spec.ts`: 下書き登録→行展開→確定、状態フィルタ、編集(金額変更)、削除(ConfirmDialog)
  - `expenses.spec.ts`: 経費登録→一覧表示(未払/下書き)→取引一覧で確定→経費側へ反映、未払→支払済
  - `sales.spec.ts`: 顧客→案件→請求書作成(下書き)→発行→入金消込→入金済み、顧客未登録時の導線表示
  - `receipts.spec.ts`: PNG アップロード→未処理→取引へ紐付け→紐付済み、アーカイブ→確認ダイアログ→アーカイブ済み
  - `closing.spec.ts`: 期間作成→下書きで締め不可→確定→締め実行→取引 locked 化(編集/削除ボタン消失)、月次レポートの科目別内訳と集計保存

### セレクタ上の注意(次の担当者向け)

- `<select>` は `getByLabel` ではなく `getByRole("combobox", { name })` で取ること。`Field` は `<label>` で control を包む構造のため、label テキストに option 群が混入し `exact` 一致が失敗する
- 金額表示は `formatYen`(ja-JP currency)で全角 `￥`(U+FFE5)になる。アサーションは `￥12,000` のように全角円記号で書く
- 取引一覧で行展開すると、編集フォーム内 input の value が展開行のアクセシブル名に混入し `getByRole("row", {name})` が複数解決になる。値でなくテキストで絞る場合は `locator("tbody tr", {hasText})` を使う
- オンボーディングが表示された時点でセッションCookieは設定済み(`/api/session` POST 完了後に signed_in になる)ため、直後に Server Action を呼んでも安全

### 実行したテスト

- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(18ファイル213件、skip 7)
- `pnpm build` — 合格
- `pnpm test:e2e` — 合格(chromium 15件、約9秒。`JAVA_HOME=/opt/homebrew/opt/openjdk@21` で実行)
- `pnpm test:rules` — 合格(2ファイル62件)

### 未解決事項・次の担当者への注意事項

- E2E は chromium のみ。firefox/webkit 追加時は projects へ追記 + `playwright install`
- Emulator 起動には JDK 21+ が必要(PATH が JDK17 なら `JAVA_HOME=/opt/homebrew/opt/openjdk@21 pnpm test:e2e`)
- 各テストは毎回 signup→事業作成を UI 経由で行うため多少のオーバーヘッドがある(15件で約9秒)。遅くなったら Emulator REST API 経由のユーザー作成に切替え可能だが、現状は実フローで検証できる利点を優先した
- カバーしていない領域: 設定画面(メンバー招待・事業設定)、AI提案カードの操作、事業切替(複数事業)、viewer ロールの読み取り専用 UI

## 2026-11-02: 実LLMプロバイダ(OpenAI)の実装

- Worktree: ai-llm-provider

### 実装内容

- `openai@7.43.0` を `pnpm add`(選択理由は備考)。SDK利用コードは `src/lib/ai/` 内に閉じ込め、依存追加の `package.json`/`pnpm-lock.yaml` 変更はこのレーンのみ
- `src/lib/ai/prompts.ts` 新規: 5種類の `SuggestionKind` ごとのタスク文・Structured Outputs用JSON Schema(strictサブセットのみ使用)・`sanitizeInput`(allowlist外フィールドの除去・文字列切り詰め・`duplicate_detection`取引の id/amount/date 射影・`monthly_explanation`の数値+yearMonthのみ射影・件数/文字数上限)で送信データを最小化
- `src/lib/ai/llm-provider.ts` 新規:
  - `LLMProvider implements AIProvider`: 注入された `LLMCaller` でJSON生成→`JSON.parse`して返却(形の検証は既存 schemas.ts に委譲)。caller例外は `provider_error`、非JSON出力は `invalid_response` の `AIProcessingError` に正規化し、SDKの生エラーメッセージ(証憑内容を含み得る)は伝播させない
  - `createOpenAICaller`: OpenAI Responses API(`json_schema`/`strict: true`、`store: false` でOpenAI側にレスポンスを保存させない)を呼ぶcaller
  - `createAIProvider`: 環境変数で選択。`AI_LLM_PROVIDER=openai` かつ `OPENAI_API_KEY` 設定時のみLLMProvider(`OPENAI_MODEL`でモデル上書き可、既定 `gpt-5-mini`)。未設定・`heuristic`・未知値・キー欠落は `HeuristicAIProvider` へフォールバック(固定文言のwarnのみ、鍵・入力値は出力しない)
  - `assertServerSide`: `typeof window !== "undefined"` で例外。APIキーは非`NEXT_PUBLIC_`環境変数経由のためサーバーのみで読める。`server-only`パッケージはroute handler/vitest等の非RSCコンテキストでindex.js(throw)に解決されるため不採用
- `src/lib/ai/llm-provider.test.ts` 新規(`@vitest-environment node`): ファクトリの分岐・フォールバック、エラー正規化、サニタイズのPII除去、`AISuggestionService`経由で `run_ai` がauditLogsに記録されること(監査要件は既存service.tsの`appendAudit`で担保)を確認
- 環境変数: `AI_LLM_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_MODEL`(`.env.example`は変更対象外のため本ファイルに記録)

### 実行したテスト

- `pnpm lint` — 合格(warning 1件は既存のreceipts-screen `<img>`)
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(19ファイル229件、skip 7。新規テスト13件)
- `pnpm build` — 合格(全ルートstatic/dynamic生成)
- Firebase Emulator tests — 未実施(JDK 21+不在の環境制約。rules変更なしのため実害なし)

### 備考

- SDK選択理由: `openai` はランタイム依存ゼロ(2026-11-02時点 v7.43.0)。`@anthropic-ai/sdk` は3依存(standardwebhooks等)、`@google/genai` は `google-auth-library`/`protobufjs` を含み最小依存要件に反するため不採用。バージョンは7日ルールに従い2026-10-22公開の 7.43.0(最新7.47.0は公開2日前で回避)
- AI呼出のauditLogs記録は `AISuggestionService.execute` の `appendAudit("run_ai")` が既に担保しており、provider側は対象識別情報以外を記録しない設計を維持(個人情報・証憑内容のログ出力なし)
- `createAIProvider` はまだどこからも呼ばれない(サーバーアクション/Route Handler側の接続は別タスク)。接続側では `AISuggestionService({ store: new FirestoreSuggestionStore(db), provider: createAIProvider() })` の形を想定
- `store: false` は単発のステートレス呼出し前提。将来 `previous_response_id` 等の会話継続が必要になった場合は再検討
## 2026-11-02: 消費税計算エンジンの実装

- Worktree: tax-calc-engine

### 実装内容

- `src/lib/accounting/domain/tax.ts` 新規: 消費税計算の純粋関数群。Firebase非依存・副作用なしで service 層(AccountingService / services/*)から直接呼べる
  - 端数処理はBusiness統一ルールに従い常に切り捨て。税率・みなし仕入率は既約分数(10%: 税抜1/10・税込1/11、8%: 2/25・2/27)で保持し、浮動小数点を介さない整数演算で算出(ADR-0002の構造的誤差排除)
  - `computeTaxAmount(amount, {basis, rate})`: 税込/税抜いずれの基準でも標準10%・軽減8%の税額を算出。0円許容・負額/小数/非安全整数を拒否、乗算オーバーフローも INVALID_AMOUNT
  - `computeNetAmount` / `sumTaxAmounts`(明細ごと切り捨て→合算)
  - `isTaxableCategory` / `maxPossibleTaxAmount` / `assertTaxAmountConsistent`
  - `computeConsumptionTaxPayable(mode, totals, {businessClass})`: taxMode 別の納付額。exempt→0、standard→outputTax−inputTax(負数=還付相当)、simple→みなし仕入率(第1〜6種=90〜40%)で控除額を切り捨て算出。simpleはbusinessClass必須、他方式では指定拒否
- `src/lib/accounting/domain/types.ts`: `TaxMode` 型(exempt/simple/standard)を追加(FIRESTORE_SCHEMAのbusinesses.taxMode)
- `src/lib/accounting/domain/validate.ts`: `validateExpenseInput` の税額チェックを「taxAmount ≤ amount」の粗い上限から `assertTaxAmountConsistent` へ置き換え(前回未解決事項の解消)。非課税・免税・不課税は税額0固定、課税仕入は税抜10%相当を上限とする
- `src/lib/accounting/index.ts`: `./domain/tax` を export 追加
- `src/lib/accounting/domain/tax.test.ts`: 25件(税率別・税込/税抜・境界端数・0円・不正入力・税区分別整合・3方式の納付額・みなし仕入切捨て)

### 設計上の判断

- `assertTaxAmountConsistent` の課税上限は `floor(amount×10%)`(税抜標準税率)。税込解釈(×10/110)より厳しくないが、Businessの会計方式(税込/税抜)を入力検証層が知らないため「いずれの解釈でもあり得る最大値」を採用。厳密な税込基準の検証はBusiness設定を引き回すようになった段階で絞る
- 本則課税の還付(控除超過)は負数の taxPayable で表現し、0でクランプしない(還付申告の根拠額になるため)
- `services/`(新世代)は別のTaxCategory表記(snake_case)を使うため本エンジンとは未接続。接続は表記統一と合わせて別タスク

### 実行したテスト

- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm typecheck` — 合格(`pnpm build` による型生成後)
- `pnpm test` — 合格(19ファイル238件、skip 7)
- `pnpm build` — 合格(全ルート static prerender)
- Firebase Emulator tests — 該当なし(rules変更なし、ドメイン層のみ)

### 未解決事項・次の担当者への注意事項

- 消費税の申告レベルの厳密計算(課税標準額の千円未満切捨て、国税6.3%/地方税2.2%の内訳、軽減税率の按分)は未実装。確定申告対応時に拡張する
- `domain/`(旧世代)と`services/`+トップレベル`*.ts`(新世代)の2系統が併存したまま。TaxCategory表記(camelCase/snake_case)やEntity型が二重定義されており、統合整理は別タスク
- `validateExpenseInput` は旧世代 `AccountingService` 経路のバリデーションであり、新世代 `services/expenses.ts` 側の税額チェック(現状 nonNegative のみ)への適用は未対応

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
