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

## 2026-11-02: 入金消込の取引紐付け強化(Issue #65)
- Worktree: payment-matching
### 実装内容
請求書の入金記録時に対応する収入取引(売上取引)を選択して消込を記録し、消込状態を一覧で可視化。`Payment.transactionId` は既存フィールドをそのまま使用(types.ts変更不要)。依存追加なし。
- `src/lib/payment-matching.ts`(新規): 純粋関数3本。`rankPaymentLinkCandidates`(同顧客=counterparty一致を先頭・日付降順、既紐付取引をexcludeIdsで除外)、`invoicePaymentProgress`(draft以外で 未入金/一部入金/入金済 を導出)、`invoiceSettlement`(paymentsのtransactionId有無で matched/unmatched 判定)
- `src/lib/validation/schemas.ts`: `paymentSchema` に `transactionId`(任意・最大200文字)を追加。クライアント/サーバー両側で同じスキーマ検証が効く
- `src/lib/actions/sales.ts`:
  - `InvoiceRow` に `payments: Payment[]`(日付昇順)を追加し、`listInvoiceRows` は入金をinvoiceId別にグルーピングして返す(入金額集計は同リストから算出)
  - `listPaymentLinkCandidates` 新設(viewer可)。請求書の `issueDate〜asOf` の `type=income` 取引を取得し、他の入金に紐付済みの取引を除いた候補を `rankPaymentLinkCandidates` で返す。顧客は `counterparty === customer.name` で判定(TransactionにcustomerIdは無いため)
  - `registerPaymentAction`: `transactionId` を受け取り、存在チェック+`type==="income"` チェックを行ってから `registerPayment` へ渡す(サービス層は既存フィールド対応済みで無変更)
- `src/app/(app)/invoices/invoices-screen.tsx`:
  - `PaymentForm` に「対応する収入取引(任意)」Selectを追加。同顧客グループ/その他(同期間)のoptgroupで候補表示。選択時に `transactionId` を送信。候補取得失敗時はヒントを出し紐付けなしで登録可能。フォーム上部に既存入金履歴も表示
  - 一覧の状態列に導出バッジを追加: `未入金`(gray)/`一部入金`(amber)/`未消込`(amber)/`消込済`(sky)。入金済は従来の StatusBadge「入金済み」が担う
  - 「入金履歴(n)」トグルで入金一覧を展開(viewer含む全ロール可)。消込済み入金は `取引を参照` リンクで `/transactions` へ遷移可能。履歴パネルと入金フォームは排他で開く
### 実行したテスト
- `pnpm install --frozen-lockfile` — 成功。依存追加なし
- `pnpm exec next typegen` + `pnpm typecheck` — 合格
- `pnpm lint` — 合格(warning 1件: 既存の receipts-screen `<img>`)
- `pnpm test` — 合格(38ファイル491件、skip 10。payment-matching.test.ts 8件追加)
- `pnpm build` — 合格
- Emulator系(`test:rules`/`test:emulators`)・`next dev` — 未実施(Issue制約で禁止。rules・サーバー書き込み経路の変更もなし)
### 設計上の判断・備考
- 「同期間」は請求書の発行日〜当日(asOf)の範囲と解釈(発行後〜入金遅延までをカバー)。発行前の前受金取引は候補に出ない(必要なら範囲拡張は別Issue)
- 「同顧客」は `counterparty === customer.name` の完全一致(TransactionにcustomerIdフィールドが無いため)。不一致の取引も「その他」グループに残し、表記ゆれの取引を選べるようにした
- 既に他の入金へ紐付いた取引は候補から除外するが、サーバー側では一意性を強制していない(1取引が複数請求の一括入金を兼ねる実態があり得るため寛容)
- 「取引側からの参照リンク」は請求書側→取引一覧(`/transactions`)へのリンクで実現。取引画面は変更範囲外のため取引詳細へのディープリンクや取引側からの逆リンクは未対応(URLパラメータ対応は別タスク)
- transactionId検証(存在+income)はaction層で実施。チェックと書込みは非アトミックだが紐付けは参照情報のため許容(消込の一意性競合も同様)
- ダッシュボード連携はIssue範囲外(別タスク)
## 2026-11-02: ダッシュボードのアラート通知とAI使用量表示(Issue #62)
- Worktree: alerts-quota
依存追加なし。`pnpm install --frozen-lockfile` 実行済み。
- `src/lib/api/rate-limit.ts`: `AI_RUN_LIMIT_PER_HOUR = 60` をexportし `aiRunRateLimiter` の limit に使用(APIが上限値を定数から返せるようにした)
- `src/app/api/ai/usage/route.ts`(新規): `GET ?businessId=` → `requireViewer` 後 `{ remaining: aiRunRateLimiter.remaining(businessId), limit: AI_RUN_LIMIT_PER_HOUR }` を返す軽量API。既存Route Handlerパターン(ApiError/toErrorResponse・`{ok,data}`エンベロープ)踏襲。回数消費はしない
- `src/lib/api-client.ts`: `AiUsage` 型と `fetchAiUsage(businessId)` を追加(requestJson経由)
- `src/lib/unclosed-months.ts`(新規・純粋関数): `countUnclosedMonths(periods, transactionMonthKeys, currentMonthKey)`。「前月以前で未締めの月」= open期間がカバーする月 ∪ 取引が存在する月(いずれも前月以前) − closed期間内の月。締め単位は会計期間で月境界に揃うため月キー範囲で判定。取引も期間も無い月は締める対象が無いため除外
- `src/lib/actions/reports.ts`: `DashboardData.unclosedMonthCount` 追加。`Promise.all` に `store.listFiscalPeriods` を1本追加し、取得済み `allTx` の月キーと合わせてカウント(viewer可の既存action内で完結)
- `dashboard-screen.tsx`: 要対応カードに「未締めの月(前月以前)」項目追加(`AttentionItem` に `unit` propを追加し `Nヶ月` 表示、リンク先 `/closing`、allClear条件にも追加)。カード見出し右側に「今時間のAI提案 残りN回」Badge(0回時amber)。AI使用量は `useApiData(fetchAiUsage)` で本体とは独立して取得し、失敗・未取得時は何も表示しない(Alertではなく非表示フォールバック)
- Issue指定のアラート(a)未入金・期限超過の請求書/(b)未処理領収書は既存の要対応カードに `/invoices`・`/receipts` 導線付きで実装済みだったため、不足していた(c)未締め月のみ追加
- `src/lib/unclosed-months.test.ts`(新規): 7件。空・取引月のみ・当月除外・open期間月(前月で頭打ち)・closed期間除外・和集合・重複除去
- `pnpm exec next typegen` — 成功(/api/ai/usage のroute型生成)
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(38ファイル491件、skip 10)
- `pnpm build` — 合格(`/api/ai/usage` が動的ルートとして登録)
- Firebase Emulator tests — 未実施(Issue制約でEmulator禁止。firestore.rules変更なし)
### 判断事項・次の担当者への注意事項
- 「未締めの月」の定義: 締め単位が会計期間(年単位)しか存在しないため、月がclosed期間に含まれるかで判定した。open期間の月は取引有無に関わらず未締めとしてカウント(最大で期間長分)。取引があるが期間未作成の月も未締めに含める(期間作成→締めの導線が必要なため)
- AI使用量はサーバー再起動でインメモリの消費数がリセットされる既知の性質(rate-limit.tsのコメントどおり最良努力制限)。表示値は参考値
- `fetchAiUsage` はセッション切れ時の再取得リトライ(callApi相当)を持たない。補助表示のため失敗時は非表示のまま
## 2026-11-02: 帳簿の印刷出力(仕訳帳・元帳・試算表)(Issue #59)
- Worktree: ledger-print
`reports/journal`・`reports/ledger`・`reports/trial-balance` の3画面に `window.print()` 印刷対応。依存追加なし。
- `src/app/globals.css`: `@media print` ブロックを新設(filing-screen の局所 `<style>` と同型のルールをグローバル化+拡張)。`aside`/`header`/`.no-print` を非表示、`main` のpadding除去、`.print-sheet`(カード装飾リセット)、`.print-only`(画面 hidden の印刷専用要素)、`.print-header`(帳票ヘッダ下線)、`.print-table`(罫線濃色化・`thead`/`tfoot` の各ページ繰返し・`tr` 改ページ回避・合計行 `tfoot` の太線強調)を追加。dark mode でも白地黒字で出るよう `body` の色を固定
- `src/app/(app)/reports/print-header.tsx`(新規): 印刷時だけ出る帳票ヘッダ(帳票名・対象期間・事業名・印刷日)。`hidden`+`.print-only` で画面非表示/印刷表示を両立
- 3画面とも `PageHeader`+フィルタ(MonthNav/科目Select)・ローディング/エラー/空状態を `.no-print` で囲み、`PageHeader.actions` に「印刷する」ボタン(データなし/0件では disabled)を追加。帳票部は `PrintHeader` + `Card.print-sheet` + `table.print-table`。ledger の対象期間は「月 / 科目名」
- `src/app/(app)/reports/print-header.test.tsx`(新規): 帳票名・期間・事業名・印刷日の出力と `hidden`/`print-only`/`print-header` クラスを検証
- `pnpm install --frozen-lockfile` — 成功。依存追加なし
- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm test` — 合格(38ファイル485件、skip 10。print-header.test.tsx 2件追加)
- `pnpm build` — 合格(3ルートとも静的生成)
- Emulator系は未実施(タスク指定により起動禁止。rules 未変更)
### 未解決事項・次の担当者への注意事項
- `@media print` がグローバル化されたため、**全ページ**の印刷で aside/header が非表示になる(元々帳票以外の印刷は想定されていなかったため影響は軽微)。filing-screen の局所 `<style>` は重複するが残置き(変更範囲外)
- monthly/filing の確認: filing は Issue #42 で印刷対応済み(window.print+no-print+print-sheet)。monthly は印刷ボタン/no-print 指定なしで未対応だが、今回の変更範囲外のため確認のみ(グローバル化によりナビ類は消えるが画面UIはそのまま出る)。対応する場合は別タスクで
- 印刷日は `todayDateString()` のレンダー時点値(印刷実行時刻とは厳密には異なる)
- 帳票の @page(用紙サイズ/余白)指定は未追加。ブラウザ既定のまま
## 2026-11-02: カスタム勘定科目・補助科目(Issue #46)
- Worktree: custom-accounts
### 実装内容
事業ごとに最大50件のカスタム勘定科目・補助科目を定義できる機能。依存追加なし。
- `src/lib/accounting/types.ts`: `CustomAccount { code, label, kind: income|expense, parentCode?, disabled? }` と `Business.customAccounts?` を追加(businessドキュメント内格納・rules変更なし)
- `src/lib/accounts.ts`: `ACCOUNT_OPTIONS` は不変のまま、`getAccountOptions(business)`(標準+カスタムをマージ。標準コード衝突・カスタム内重複は無視/先勝ち)、`accountLabelIn(options,code)`、`accountOptionsFor(kind, options)`(無効科目を除外して種別絞り)を追加
- `src/lib/hooks/use-accounts.ts`(新規): `useApp().business` からマージ済みoptionsと `label`/`optionsFor` を返す共通hook
- `src/lib/validation/schemas.ts`: `accountCode`(英数+`_`)、`customAccountItemSchema`、`customAccountsSchema`(上限50件・code一意)を追加
- `src/lib/actions/accounts.ts`(新規): `saveCustomAccounts`(owner限定。zod検証・code一意・標準科目衝突拒否・上限50件をサーバーでも強制、`update_business_settings`監査)と `listUsedAccountCodes`(取引で使用中の科目コード集合を返す)
- `src/lib/actions/businesses.ts`: `MyBusiness`/`listMyBusinesses`に `customAccounts` を通し、クライアント側hookが追加fetchなしで解決できるようにした
- `/accounts` 管理ページ新設(`page.tsx`+`accounts-screen.tsx`): 一覧(標準科目+カスタム、親科目名・使用状態・有効/無効)・追加・編集・無効化/有効化・削除。使用中科目は削除ボタンを出さず無効化のみ可能(viewerは閲覧のみ)
- `app-shell.tsx`: ナビに「勘定科目」を1行追加
- `src/lib/csv.ts`: `parseTransactionsCsv`/`buildTransactionsCsv`/`transactionToCsvRow` が任意の `options` を受け、科目コード照合・科目名解決をbusiness-awareに。無効科目は取込時エラー、コードはそのまま保持
- 参照差し替えのみ: 取引フォーム・一覧・CSV取込・経費登録・レシート・ダッシュボード・締め・月次/仕訳帳/総勘定元帳/試算表・AI提案カード/一覧が `useAccounts()`/`useBookAccountLabel()` 経由でカスタム科目を解決。AI `accountCandidates` には有効科目一覧を渡す
- `src/lib/accounts.test.ts`(新規): マージ・衝突/重複無視・無効科目のlabel解決と絞り込み除外。`src/lib/csv.test.ts`: カスタム科目の受理/無効科目拒否・科目名出力
- `docs/FIRESTORE_SCHEMA.md`: businessesの `customAccounts` フィールド追記
### 実行したテスト
- `pnpm install --frozen-lockfile` — 成功
- `pnpm exec next typegen` — 成功(/accountsのroute型生成)
- `pnpm lint` — 合格(warning 1件: 既存の `<img>`)
- `pnpm typecheck` — 合格
- `pnpm test` — 合格(30ファイル377件、skip 10)
- `pnpm build` — 合格(`/accounts` が静的ルートとして登録)
- Emulator系は未実施(rules変更なしのため既存rulesテストで担保)
### 未解決事項・次の担当者への注意事項
- code許容文字は `A-Za-z0-9_`(Issueは「英数」だが既存コードに合わせ `_` も許可)。UIのエラーメッセージも同文言
- `parentCode` は表示用メタデータのみ(集計ロジックには未接続)。科目の親子集計を帳票へ出す場合は別途設計が必要
- 保存は全体置換(編集競合は後勝ち)。同時編集が問題になる規模なら `updatedAt` 楽観ロックを検討
- 無効科目は新規選択肢とCSV取込から外れるが、既存取引の表示ラベルとしては解決される(履歴保護のため意図的)
## 2026-11-02: 年次集計・消費税区分・決算書帳票(Issue #42)
- Worktree: tax-filing
- `pnpm install --frozen-lockfile` — 成功。依存追加なし
- `src/lib/accounting/domain/yearly.ts`(新規): `buildYearlyReport`(会計年度開始月から12か月の月別収支推移+科目別年間合計。fiscal.ts の `fiscalPeriodRange` で期間決定、confirmed/locked の income/expense のみ・月次集計と同じ除外条件)と `buildConsumptionTaxSummary`(区分別集計。課税は税率別に標準/軽減を分割、未分類バケット付き。取引自身の taxCategory を優先し無ければ紐付く Expense の区分をフォールバック使用。課税は税込金額からの内税推定 `computeTaxAmount`、支出側は Expense.taxAmount の申告額を優先。`filingAmounts` は `computeConsumptionTaxFiling` への税率別入力)
- `src/lib/accounting/domain/filing.ts`(新規): `buildIncomeStatement`(accountTotals → 収入金額/売上原価(科目コード `purchases` のみ)/経費/差引金額)、`computeNetIncome`(差引金額 − 専従者給与 − 青色申告特別控除 = 所得金額。控除上限65万円・所得を上限に切り詰め・0未満不可)、`BLUE_RETURN_DEDUCTION_MAX`。summary.ts の既存関数は未変更
- `src/lib/accounting/types.ts`: `Transaction` に任意フィールド `taxCategory`/`taxRate` を追加(未設定=税導入前データの後方互換)
- `src/lib/validation/schemas.ts`: `taxCategorySchema` を切り出し(expenseSchema 側も共有化)。`transactionSchema` に `taxCategory`/`taxRate` を `.nullable().optional()` で追加 + 税率は課税のみの refine
- `src/lib/accounting/services/transactions.ts`: `normalizeTransactionTax` 新設(課税の税率省略→standard、課税以外への税率付与→INVALID_INPUT)。`registerTransaction` が正規化後の値を保存
- `src/lib/actions/transactions.ts`: create/update に税フィールドを配線。**更新セマンティクスは `undefined`(省略)=既存値保持・`null`=クリア**(receipts-screen 等の税フィールドを送らない既存呼び出しで区分が消えないようにするため。フォームは必ず値か null を送る)。区分が課税でなくなった場合は保持中の税率を落としてから正規化
- `src/app/(app)/transactions/transaction-form.tsx`: 「消費税区分」select を追加(未指定/課税10%/課税軽減8%/非課税/不課税(対象外)/免税)。課税は税率込みの1セレクトに畳み込み、送信時に `taxCategory+taxRate` へ展開。transactions-screen 本体は無変更
- `src/app/(app)/reports/actions.ts`: `getYearlyReport`(年度範囲の取引+経費を読み、年次集計・区分別消費税集計・申告レベル概算を返す。`requireViewer`+`getStore`、年度1900..2200検証。簡易課税は事業区分未設定のため taxFiling=null)と `getFilingStatement`(事業名+IncomeStatement)を追加。集計は保存しない
- 新規ページ: `reports/yearly`(年度ナビ・月別収支推移表・科目別年間合計表・消費税区分別集計表・申告概算)、`reports/filing`(収支内訳書様式レイアウト: 収入金額/売上原価/経費/差引金額 + 専従者給与・青色申告特別控除の入力欄(0〜65万検証) + 所得金額。`@media print` でナビ/入力欄を隠す印刷対応、`filing-sheet.tsx` を帳票部品として分離)。共通の `reports/year-nav.tsx` を新設。いずれも `useApp`/`useApiData`/`PageHeader` の既存レポートパターン踏襲
- `src/components/app-shell.tsx`: ナビに「年次レポート」(`/reports/yearly`)と「決算書(収支内訳書)」(`/reports/filing`)を1行ずつ追加
- `pnpm lint` — 合格(warning 1件: receipts-screen の `<img>`、既存)
- `pnpm exec next typegen` + `pnpm typecheck` — 合格
- `pnpm test` — 合格(31ファイル390件、skip 10。`domain/yearly.test.ts`・`domain/filing.test.ts` 新規 + `services/transactions.test.ts` に税正規化6件追加)
- `pnpm build` — 合格(`/reports/yearly`・`/reports/filing` が静的路由として生成)
- Firebase Emulator tests — 未実施(タスク指定により Emulator 起動禁止。firestore.rules 未変更)
### 変更範囲について(重要な判断)
- Issue の変更範囲指定は「reports新規ページ/domain新規ファイル/transactionsフォーム/app-shellナビ/queries.ts・api-client.ts」だが、**税区分を永続化するため Transaction 型・zodスキーマ・service正規化・Server Action への配線(types.ts/schemas.ts/services/transactions.ts/actions/transactions.ts)が必須のため拡張した**。クライアントクエリ層(queries.ts/api-client.ts)はレポートが Server Action 経由のため変更不要で未変更
- settings画面・csv.ts・accounts.ts・firestore.rules は未変更。`validTransaction` の rules はフィールド追加を制限しないため rules 変更不要
- 取引の税区分は税込金額の内税計算による推定表示。Expense のような実消費税額フィールドは取引側に持たないため、申告概算は概算値である旨を帳票上で明示すべき余白あり
- 売上原価の判定は科目コード `purchases` のみ(accounts.ts の勘定体系が限定的なため)。勘定体系拡張時は振り分け定数の見直しが必要
- 簡易課税のみなし仕入率(事業区分)は Business に設定項目がなく未対応のため、yearly の申告概算では null を返し画面側で非表示にしている
- 「決算書」は収支内訳書(一般用)様式風レイアウトで、青色申告決算書(不動産/農業用)や e-Tax 連携は対象外
- 領収書→取引更新経路(updateTransaction の税フィールド省略)は既存値保持セマンティクスで保護済みだが、将来の呼び出し元追加時に同セマンティクスが伝わるよう schemas.ts コメントで明記した
## 2026-11-02: 家事按分(科目別事業割合)(Issue #43)
- Worktree: household-alloc
経費科目ごとの事業割合(%)をBusinessに保存し、月次レポートで按分後金額を表示列として確認できるようにした。依存追加なし。
- `src/lib/accounting/types.ts`: `Business.allocationRatios?: Record<accountCode, number(0-100)>` を追加(オプショナル。未設定科目は100%扱い)
- `src/lib/accounting/domain/allocation.ts`(新規): 按分ドメインロジック
  - `isAllocationRatio` / `assertAllocationRatio`: 0-100整数の割合検証
  - `allocatedAmount(amountYen, ratioPercent)`: `floor(amount*ratio/100)` で円・整数。端数は切り捨て(ACCOUNTING_RULES.mdの初期版ルールに合わせ、経費を過大計上しない丸め)
  - `allocationRatioFor(ratios, account)`: 未設定・範囲外の保存値は100%へフォールバック(表示側を壊さない)
  - `applyAllocation(breakdown, ratios)` / `allocatedExpenseTotal`: 科目別集計へ按分後列を付与する表示用関数。`MonthlySummary.accountBreakdown` と同じ `{income,expense}` 構造を入力に取り、summary.ts等の既存集計は変更していない
- `src/lib/validation/schemas.ts`: `businessSchema` に `allocationRatios`(z.record(0-100整数))をオプション追加
- `src/lib/actions/businesses.ts`: Issue指定どおり既存のbusiness更新actionを利用
  - `MyBusiness` / `listMyBusinesses` で `allocationRatios` を返すようにした(画面側の読み取り経路)
  - `updateBusinessSettings` は `allocationRatios` が指定された時のみ上書き。未指定(既存の設定画面)は現値を維持するため、設定画面・firestore.rulesの変更は不要(ownerUid不変ルールのみで追加フィールドを拒否しない)
- `src/app/(app)/allocations/`(新規): 専用ページ(/settings配下ではない)。経費科目(ACCOUNT_OPTIONSのkind=expense)ごとに0-100を入力保存。未入力=未設定(100%)。UIに無い科目の保存済み割合は上書きしない(マージ保存)。ownerのみ編集可(流用するactionがowner必須のため)、非ownerは読み取り表示
- `src/app/(app)/reports/monthly/monthly-report-screen.tsx`: `applyAllocation` で按分率・按分後支出列と「差引(按分後)」を追加。割合未設定時は従来表示のまま
- `src/components/app-shell.tsx`: ナビに「家事按分」を1行追加
- `docs/FIRESTORE_SCHEMA.md`: businessesに `allocationRatios` を追記
- `pnpm install --frozen-lockfile` — 成功
- `pnpm exec next typegen` — 成功
- `pnpm test` — 合格(30ファイル374件、skip 10。`domain/allocation.test.ts` 11件を新規追加)
- `pnpm build` — 合格(`/allocations` が静的ルートとして登録)
- Firebase Emulator テスト — 未実施(Issue制約でEmulator起動禁止。rules変更なしのため影響なしと判断)
- 按分は表示専用で `monthlySummaries` 等の保存データには反映していない(Issueの「表示列追加レベル」指定どおり)。確定申告出力・決算書で按分額が必要になったら同じ `domain/allocation.ts` を再利用する
- 割合編集はownerのみ(`updateBusinessSettings` 流用のため)。editorにも開放する場合はaction側の認可変更が必要
- 按分ページは事業名等の既存値を `useApp().business` から同時送信する。別タブで事業設定を直後に変更した場合に古い値で上書きする可能性がある(設定画面と同じ既知の性質)
## 2026-11-02: 定期取引テンプレート(Issue #45)
- Worktree: recurring-tx
毎月繰り返し発生する取引のテンプレート(recurringTemplates)管理と、「今月分を生成」による取引一括作成。依存追加なし。
- `src/lib/accounting/types.ts`: `RecurringTemplate` 型追加(name/type/account/counterparty/description/amount/dayOfMonth/active/lastGeneratedMonth?/createdBy/createdAt/updatedAt)
- `src/lib/accounting/store/types.ts`: `CollectionName` に `"recurringTemplates"` 追加。`AccountingReader` に `getRecurringTemplate` / `listRecurringTemplates` 追加。`store/memory.ts`・`store/firestore.ts` に実装
- `src/lib/accounting/services/recurring.ts`(新規):
  - `registerRecurringTemplate` — active=true で登録(idempotencyKey対応)
  - `updateRecurringTemplate` — 全項目更新(createdBy/createdAt維持)
  - `setRecurringTemplateActive` — 有効/無効切替(同一状態への再実行は冪等)
  - `generateRecurringTransactions` — 指定月(yyyyMM)に `active && lastGeneratedMonth !== monthKey` のテンプレートから draft 取引を1transactで一括生成。dayOfMonthが月末超過時は末日へ調整(`lastDayOfMonth`)。取引IDは `recurring-{templateId}-{yyyyMM}` で決定的(二重実行・再生成の安全網)。既存取引がある場合は上書きせず lastGeneratedMonth のみ進める。`assertDateInOpenPeriod` で締め済み期間への生成を拒否
- `src/lib/validation/schemas.ts`: `recurringTemplateSchema`(name/type/account/counterparty?/description?/amount/dayOfMonth)と `recurringTemplateUpdateSchema`(+active)を追加
- `src/lib/actions/recurring.ts`(新規・Server Actions): `listRecurringTemplates`(requireViewer、createdAt昇順)、`createRecurringTemplate` / `updateRecurringTemplateAction` / `setRecurringTemplateActiveAction` / `generateRecurringForMonth`(すべてrequireEditor)。生成は `{ created }` 件数を返す
- `firestore.rules`: `recurringTemplates` match追加。get/list=isMember、create=canEdit+`validRecurringTemplate`+createdBy一致、update=canEdit+valid+`unaffected(['createdBy','createdAt'])`、delete=canEdit。`validRecurringTemplate` は name/type/account/amount(int)/dayOfMonth(int 1-31)/active(bool)を検証し、counterparty/description/lastGeneratedMonthは存在時のみstring検証
- `firestore.indexes.json`: 一覧は全件取得+メモリソートのため複合インデックス不要(変更なし)
- `src/app/(app)/recurring/`(新規): `page.tsx` + `recurring-screen.tsx`。一覧表(名前/種別/科目/金額/毎月の日/状態/最終生成月)・登録/編集フォーム・無効化/有効化ボタン・「今月分を生成」ボタン(ConfirmDialog→`generateRecurringForMonth`、結果件数をAlert表示)。viewerはボタン類を全て非表示(canEdit=business.role!=="viewer")
- `src/components/app-shell.tsx`: ナビに「定期取引」1行追加(取引一覧の直下)
- `docs/FIRESTORE_SCHEMA.md`: recurringTemplatesのコレクション定義を追記
- `tests/rules/helpers.ts` + `tests/rules/firestore.rules.test.ts`: `recurringTemplate` fixtureと describe ブロック追加(読み取り権限・作成/更新/削除・createdBy不一致・dayOfMonth 0/32・type/amount/active不正・createdBy/createdAt不変性)
- `src/lib/accounting/services/recurring.test.ts`(新規): 13件。登録・更新・無効化、月末調整(31日→2/28)、同月再実行の冪等性、翌月再生成、無効テンプレート除外、closed期間拒否、不正monthKey拒否
- `pnpm lint` — 合格(warning 1件: 既存の receipts-screen `<img>`)
- `pnpm test` — 合格(30ファイル378件、skip 10)
- `pnpm build` — 合格(`/recurring` が静的ルートとして登録)
- `pnpm test:rules` — 合格(2ファイル71件。JAVA_HOME=openjdk@21でEmulator実行)
- 生成される取引は常に `status="draft"`。「AIだけで仕訳を確定しない」方針に従い、確定は取引一覧側のユーザー操作に委ねる
- 「今月分を生成」の transact には全体idempotencyKeyを付けていない(月キーで固定すると当月追加されたテンプレートが生成されなくなるため)。代わりに lastGeneratedMonth の読み書き不可分 + 決定的取引ID(`recurring-{templateId}-{yyyyMM}`)で冪等性を担保。Firestore transactionの競合リトライでも重複しない設計
- テンプレート編集で金額・日付を変更しても、生成済み(lastGeneratedMonth)の月には遡って再生成しない。当月分をやり直したい場合は生成済み取引を削除したうえで lastGeneratedMonth をリセットする運用が必要(画面からは不可・Adminのみ)
- rules の delete は canEdit 許容(customers/projects と同水準)。要件の操作は無効化(active=false)で実現しており、画面からの削除導線は用意していない
- E2E(`tests/e2e`)未実施。`/recurring` のE2Eカバレッジは既存画面と同じく別Issue扱い
## 2026-11-02: 期首残高/繰越設定(Issue #49)
- Worktree: opening-balance
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
- `pnpm install --frozen-lockfile` — 成功
- `pnpm exec next typegen` — 成功(LayoutProps等の生成型が無いとtypecheckが落ちるため)
- `pnpm lint` — 合格(warning 1件: 既存の `<img>` のみ)
- `pnpm test` — 合格(29ファイル374件、skip 10)
- `pnpm build` — 合格(`/opening-balances` が静的ルートとして登録)
- Emulator系はIssue制約により未実行
### 備考・次の担当者への注意事項
- 期首残高の転記日は「前会計年度の末日」。会計年度開始月が4月等でも当年度の全月で繰越側に集約される。前期最終月の元帳に「期首残高」行として現れることはない(表示月のFYでフィルタするため)
- 試算表は月内取引+期首残高のみの合計。月初以前の期中取引は含めない既存仕様のまま(残高試算表への拡張は別課題)
- 保存は owner のみ(`updateBusinessSettings` と同じ権限)。editorに開放する場合は `requireEditor` へ変更
- 締め済み年度の編集はサーバー側で拒否するが、UI側では年度を選べてしまう。FiscalPeriod一覧を取って該当年度を非活性にする改善余地あり
## 2026-11-02: 全データJSONバックアップ/復元(Issue #47)
- Worktree: backup-restore
依存追加なし。`pnpm install --frozen-lockfile` 実行済み。
- `src/lib/backup.ts`(新規): businessスコープの全データを1つのJSON(`version:1`付き)にエクスポート/復元するロジック。クライアント側でもzodスキーマを使うため firebase-admin の値importは持たない(`import type`のみ)
  - `BACKUP_COLLECTIONS`: firestore.rulesの実在14コレクション(members/customers/projects/transactions/expenses/receipts/invoices/payments/journalEntries/fiscalPeriods/closingChecks/aiSuggestions/monthlySummaries/auditLogs)。`idempotencyKeys`は内部機構、`users`はbusinessIdスコープ外のため対象外
  - `backupFileSchema`(zod): version=1固定・businessId必須・各docは`id`必須のlooseObject。businessはname/fiscalYearStartMonth/taxModeのみpartial受理(ownerUid等はstripで落とす)。未知コレクションは受理して前方互換
  - `exportBusinessBackup(db,businessId)`: businessドキュメント+全コレクションを取得しJSON化(Timestamp→ISO文字列、docデータ内idよりdoc.idを正とする)
  - `planRestore`(純粋関数): ID衝突解決の書き込み計画。衝突時は新規採番し参照フィールド(transactionId/receiptId/customerId/projectId/invoiceId/receiptIds/fiscalPeriodId/sourceId/target.id)を張替。docデータ内の`businessId`/`targetPath`も復元先へ書き換え
  - `restoreBusinessBackup(db,...)`: 既存IDを`listDocuments()`で収集→planRestore→400件ずつbatch commit。businessドキュメントは許可フィールドのみmerge
- `src/app/api/backup/route.ts`(新規):
  - `GET ?businessId=` → `requireEditor`(owner/editor)でJSONをattachmentダウンロード
  - `POST {businessId,backup}` → `requireOwner`で復元。content-length上限64MB・zod再検証・auditLogsへ`update`記録
- `src/app/(app)/backup/page.tsx` + `backup-screen.tsx`(新規): エクスポートボタン(blob→ダウンロード)・JSON選択→クライアント側zod検証→コレクション別件数プレビュー→ConfirmDialog経由で復元実行。復元はownerのみUI表示
- `src/lib/api-client.ts`: `restoreBackup`追加
- `src/components/app-shell.tsx`: ナビに「バックアップ」1行追加
- `src/lib/backup.test.ts`(新規): 12件。スキーマ受理/拒否、summarize、planRestore(新規採番・参照張替・固定ID skip・protectedUids・パス書換・ファイル内重複ID・未知コレクション)
### 設計上の判断
- **復元はowner限定**(エクスポートはowner/editor): members復元による権限昇格・auditLogs偽装・締め済みデータ改変を防ぐため
- **固定IDコレクション**(members=uid/fiscalPeriods=fy{year}/monthlySummaries=yyyyMM)は新規採番すると意味が壊れるため、衝突時は既存維持でskip。それ以外の衝突は新規採番
- **protectedUids**: 復元実行者・business.ownerUidのmemberドキュメントは常にskipし、自己降格・ロックアウトを防止
- **復元はマージ型**: 既存データの削除・上書きは行わない(set先は必ず未使用ID)
- **`*At`フィールドの日時復元**: 時刻部(T)を持つISO文字列のみDate化→Timestamp。`paidAt`等のYYYY-MM-DD文字列は文字列のまま維持(toStoreの無条件`*At`変換と異なり型を壊さない)
- 証憑のstoragePathはファイル実体の場所を指すため復元時も書き換えない(ファイル本体のコピーは範囲外)
- `pnpm lint` — 合格(既存warning 1件のみ: receiptsの`<img>`)
- `pnpm typecheck` — 合格(`pnpm exec next typegen` 実行後)
- `pnpm build` — 合格(`/api/backup`が動的ルート、`/backup`が静的ページとして登録)
- Firebase Emulator tests — 該当なし(backup.tsは純粋関数を単体テスト。Rules変更なし)
- 復元の書き込みはバッチ400件単位の逐次commitで全件アトミックではない。大量データの復元途中失敗は部分適用になりうる(監査ログは成功時のみ記録)
- 証憑ファイル本体(Storageオブジェクト)はバックアップ対象外。別businessIdへの復元時、storagePathは元businessのパスのまま(アクセス可否は元事業のmembership依存)
- 復元にレート制限は未設定(ownerのみの低頻度操作想定)。必要ならrate-limit.tsへ追加
- エミュレータ・実DBでの往復検証は未実施。Emulator環境でのexport→restoreの実動作確認が望ましい
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
## 2026-11-02: 銀行/カード明細CSVインポートと自動マッチング(Issue #44)
- Worktree: bank-import
### 実装内容
取引とは別形式の「銀行・カード明細CSV」から候補取引を一括取込する専用画面 `/transactions/import`。依存追加なし。
- `src/lib/bank-csv.ts`(新規):
  - `parseBankCsv`: `csv.ts` の `parseCsv` を再利用し、先頭10行以内から「日付 + 金額系列」を持つ行をヘッダー検出(口座情報等の前置行を読み飛ばす)。列名ゆらぎは `HEADER_ALIASES` の正規化別名表(全角数字・空白・末尾の「(円)」等の単位括弧を除去して照合)で吸収し、列順の入れ替え・余分列を許容。必須は 日付・摘要・金額系のいずれか
  - 金額列の形式を `split`(出金額/入金額 別列: 出金→支出・入金→収入)と `single`(「金額/利用金額」単一列: 全行支出)に分けて解釈。両列値あり・負数(△/▲/−/(…)表記)・非数値・日付解釈不能は行エラー、金額が空の行(繰越・見出し等)は `skippedReason` 付きの対象外行(エラーにしない)
  - `normalizeBankDate`: YYYY-MM-DD/YYYY/M/D/YYYY.M.D/YYYYMMDD/YYYY年M月D日/和暦(令和N年・R8.11.6 等・元号+元年)を正規化。曜日括弧・時刻末尾を除去。年なし表記(M/D等)は推測せず不受理
  - マッチング: `findExistingMatches`(同金額・日付差±N日の既存取引を日付差順で返す。AI提案 duplicate_detection「金額・日付一致」の近日付拡張をクライアント側で実施)と `findInFileDuplicatePartners`(同一CSV内で 日付+種別+金額 一致行を相互参照)、照合窓算出用 `shiftDate`
- `src/app/(app)/transactions/import/`(新規: `page.tsx` + `import-screen.tsx`):
  - ファイル選択→`decodeCsvBytes`デコード(既存CSV取込と同じShift_JISフォールバック)→パース→候補一覧。候補日付範囲±3日の既存取引を `listTransactions` で取得し行ごとに照合。既存取引取得失敗時は警告を出しファイル内重複チェックのみで継続
  - 各行: 選択チェック・日付・摘要・種別(推定値を初期値とするSelect、支出/収入/振替に変更可)・金額・勘定科目Select・マッチング状態(既存取引との重複可能性=amberバッジ+titleで候補日付金額、ファイル内重複=skyバッジ+相手行番号)・結果(エラー/対象外/登録済み/失敗)
  - 重複可能性フラグのある行は誤登録防止のため初期選択外。登録は既存 `createTransaction` を行ごとに逐次呼出し(冪等キーは行ごとに採番済み)、失敗行のみ再実行可能。全件一括トランザクションではなく既存CSV取込と同じ部分失敗モデル
  - 「支出の既定科目」「収入の既定科目」で未個別編集行(accountAuto)を一括追従。行の種別変更時は種別に対応した既定科目へリセット。登録は全て下書き、摘要は description へ(counterparty は空)
  - viewerは `business?.role !== "viewer"` で判定し EmptyState で拒否(取引一覧へのリンクのみ)
- `transactions-screen.tsx`: PageHeader に `next/link` の「明細CSVインポート」ボタン(secondaryスタイルのクラスをLinkへ適用)を `canEdit` ブロック内に1個追加。既存「CSV取込」ボタンはそのまま
- `src/lib/bank-csv.test.ts`(新規): 24件。基本形/列名ゆらぎ(メガバンク風・ゆうちょ風)/列順入れ替え/前置行読み飛ばし/単一金額列モード/日付各種表記(和暦含む)/金額正規化/繰越行スキップ/両列値・負数・非数値・不正日付エラー/ヘッダー欠如・摘要欠如/重複マッチング/ファイル内重複
### 実行したテスト
- `pnpm install --frozen-lockfile` — 成功
- `pnpm exec next typegen` + `pnpm typecheck` — 合格
- `pnpm lint` — 合格(warning 1件: 既存の receipts-screen `<img>`)
- `pnpm test` — 合格(30ファイル389件、skip 10。bank-csv.test.ts 24件含む)
- `pnpm build` — 合格(`/transactions/import` が静的ルートとして生成)
- Firebase Emulator tests — 未実施(rules・サーバー書き込み経路の変更なし。起動自体がIssue制約で禁止)
### 設計上の判断・備考
- 照合対象の既存取引は候補日付範囲±3日に限定して取得。遠い日付の同金額取引はフラグされない(duplicate_detection提案と同様、検出漏れは許容する設計)
- 重複判定は金額+日付差のみで種別・摘要は見ない(既存ヒューリスティックと同種)。摘要類似度まで見るかは別IssueのAI提案側の責務
- 負数金額(返金・取消等)は取込エラーとし登録不可。Transactionが正の金額しか持てない現モデルに合わせた
- `single`モード(金額単一列)はカード明細向けに全行を支出として推定。出金/入金別列があれば `split` を優先し単一列は無視
- 全角元号アルファベット(Ｒ等)は数字のみ半角化するため列名・日付ともに対象外(半角表記のみ受理)
- `api-client.ts`・`csv.ts`・`accounts.ts`・`firestore.rules`・設定画面は変更なし(許容範囲内で不要だった)
- E2E(`pnpm test:e2e`)は未実施。新規画面のE2Eカバレッジは別タスク
## 2026-11-02: パスワードリセットと事業削除(Issue #63)
- Worktree: account-lifecycle
### 実装内容
- パスワードリセット: 公開ページ `/reset-password` 新設(`src/app/reset-password/page.tsx` + `reset-password-screen.tsx`)。メール入力 → `sendPasswordResetEmail`(firebase client SDK) → 送信完了表示 + ログイン画面へのリンク。`/login` 画面(signinモード時)に「パスワードを忘れた方はこちら」導線を追加
- `src/lib/validation/schemas.ts`: `passwordResetSchema`(emailのみ)を追加
- 事業削除: `src/lib/actions/businesses.ts` に `deleteBusiness(businessId, confirmName)` Server Action を追加。`requireOwner` でowner限定、事業名の完全一致をサーバー側でも検証。`getAdminBucket().deleteFiles({prefix: "receipts/{businessId}/"})` で証憑ファイルを削除後、`db.recursiveDelete` でbusinessドキュメント+全サブコレクションを削除(実在コレクション: members/transactions/expenses/receipts/customers/projects/invoices/payments/journalEntries/recurringTemplates/closingChecks/aiSuggestions/monthlySummaries/fiscalPeriods/auditLogs/idempotencyKeys — rules/docs/FIRESTORE_SCHEMA.md/store typesから洗い出し)
- `/business-delete` 専用ページ新設(`src/app/(app)/business-delete/`): settings画面は変更不可のため独立ページ。非ownerは警告のみ表示。事業名入力(完全一致でボタン活性化)+ ConfirmDialog の二重確認。成功後は `reloadBusinesses()` → `/dashboard` へ遷移
- `app-shell.tsx`: ナビに「事業の削除」を1行追加(バックアップの次・管理系末尾)
### 実行したテスト
- `pnpm install --frozen-lockfile` — 成功。依存追加なし
- `pnpm exec next typegen` + `pnpm typecheck` — 合格
- `pnpm lint` — 合格(warning 1件: 既存の receipts-screen `<img>`)
- `pnpm test` — 合格(37ファイル483件、skip 10)
- `pnpm build` — 合格(`/reset-password`・`/business-delete` が静的ルートとして生成)
- Firebase Emulator tests — 未実施(Issue制約で起動禁止。firestore.rules/storage.rules の変更なし)
### 設計上の判断・備考
- 削除は `db.recursiveDelete`(Admin SDK・BulkWriter経由)を採用。コレクション名のハードコード列挙ではなく存在する全サブコレクションを再帰削除するため、将来追加されるコレクションも漏れなく削除される
- Storageの `receipts/{businessId}/` 配下はFirestoreより先に削除。Firestore先行だと失敗時に残骸ファイルを事業単位で追えなくなるため
- `users/{uid}`・Firebase Authアカウントは削除対象外(事業が消えてもアカウントは残る)。membersサブコレクションは事業配下のため削除される
- 監査ログへの記録は実施せず。auditLogsは事業配下のため削除と同時に消え、証跡として残らない
- 締め済み期間のデータも含めて全削除される(事業ライフサイクル操作としてIssueの要件どおり。ロックデータの直接変更禁止ルールとは別枠)
- `deleteBusiness` は `confirmName` を文字列引数で受け取る(removeMember等と同じスタイル)。zodスキーマは使わず、サーバー側で事業名との完全一致のみ検証
- Emulator・`next dev` は制約で未起動のため実動作確認はE2Eなし
## 2026-11-02: グローバル検索と入力履歴サジェスト(Issue #61)
- Worktree: search-suggest
- `/search` 新規画面(`src/app/(app)/search/`): フリーテキストで摘要・取引先・科目・金額を横断検索。確定済み(confirmed/locked)のみ、businessIdは `requireViewer` でスコープ。期間は「全会計期間(既定)/直近1年/期間を指定(任意の片側のみも可)」。結果は日付降順テーブルで、各行に取引一覧へのリンク(50件ずつ「さらに読み込む」)
- `src/lib/search.ts`(新規): `transactionMatchesQuery`(空白区切りトークンのAND。各トークンは 摘要/取引先/科目コード/科目名/金額 のいずれかに部分一致。金額は数字以外を落として比較)と `normalizeSearchText`(NFKC正規化で全角英数・半角カナ・全角スペースを吸収)、`recentDistinctValues`(直近利用順distinct)
- `src/lib/actions/search.ts`(新規): `searchTransactions`。`listTransactionsInRange` で範囲取得後、科目ラベル(標準+カスタム科目)を解決してマッチング。未指定期間は `0001-01-01`〜`9999-12-31`
- `src/lib/validation/schemas.ts`: `transactionSearchSchema`(query≤200文字、任意期間、startDate≤endDateのrefine)追加
- `src/lib/actions/transactions.ts`: `listTransactionInputHistory` 追加。全期間の取引(下書き含む)から取引先・摘要のdistinct値を直近利用順で返す
- `transaction-form.tsx`: 取引先・摘要に `<datalist>` オートコンプリート。履歴はフォーム内で `listTransactionInputHistory` を取得(親画面は変更不可のため自己完結)。摘要は datalist 非対応の `Textarea` から `TextInput` へ変更(もともと rows=1 の単一行)
- `app-shell.tsx`: ナビ「取引一覧」の次に「検索」を1行追加
- `src/lib/search.test.ts`(新規): 14件。正規化(全角/半角カナ/空白畳み)、横断一致(摘要/取引先/科目コード/科目名/金額各表記)、ANDトークン、空クエリ全件一致、distinct順序/空除外/limit
- `pnpm install --frozen-lockfile` — 成功(依存追加なし)
- `pnpm test` — 合格(38ファイル496件、skip 10。search.test.ts 14件含む)
- `pnpm build` — 合格(`/search` が静的ルートとして生成)
- Firebase Emulator tests — 未実施(rules・サーバー書き込み経路の変更なし。起動自体がIssue制約で禁止)
- Firestoreに全文検索が無いため、期間範囲の取引取得→`transactionMatchesQuery` でサーバー側フィルタ。期間未指定は既存と同じ全期間rangeを使う
- 検索対象は confirmed/locked(=確定済み)に限定。入力履歴サジェストは入力補助のため下書きも含める
- 金額検索はトークンの数字以外を除去して部分一致(「12,000」「¥12000」「12000円」「１２０００」いずれも金額12000に一致)
- 結果行のリンク先は `/transactions`(同画面は月単位表示・deep link未対応のため一覧入口への遷移)
- datalistは `<input>` 専用のため摘要フィールドを `Textarea(rows=1)` → `TextInput` に変更。単一行UI・スキーマ(max 500)は不変
- `queries.ts`/`api-client.ts` は変更なし。検索・履歴ともドメインstore(`getStore().listTransactionsInRange`)とServer Action経由で既存パターンの範囲に収まった
- E2E(`pnpm test:e2e`)は未実施。新規画面のE2Eカバレッジは別タスク
## 2026-11-02: 取引の一括操作(Issue #64)
- Worktree: bulk-ops
取引一覧 `/transactions` に下書き取引への一括操作を追加。変更は `transactions-screen.tsx` のみ(`api-client.ts`・他画面・domain・rules等は変更不要だった)。依存追加なし。
- 選択列: `canEdit`(viewer以外)時のみテーブル先頭にチェック列を追加。ヘッダのチェックで表示中の下書き行を全選択/全解除(一部選択時は indeterminate 表示)。行チェックは `stopPropagation` で展開トグルと分離
- 選択不可行: confirmed は「確定済みの取引は一括操作できません(行の展開から個別に操作してください)」、locked(締め済み期間)は「締め済み期間の取引は一括操作できません」を `title` ツールチップ+`aria-label`で表示し disabled チェックボックスを描画。選択可能行は `status === "draft"` のみ(`toggleSelect` ガードと操作対象の派生フィルタで二重に防御)
- 操作バー(`BulkActionBar` コンポーネント): 選択中のみ表示し「N件選択中」「科目select→科目を一括変更」「一括削除」「選択解除」を提供。実行中は全操作をロックし `Spinner` + `done/total 件を処理中…` の進捗を表示
- 一括削除: `ConfirmDialog` で件数確認後、行ごとに `deleteTransaction` を順次呼出し(既存CSV取込・明細インポートと同じ部分失敗モデル)
- 科目一括変更: 選択行の `type` 全てに適用できる科目の共通部分(`optionsFor` の積集合。混在時は kind=any のみ)を選択肢として提示し、行ごとに `updateTransaction` を順次呼出し。taxCategory/taxRate は省略(=サーバー側で既存値保持)
- 結果表示: `Alert` で「N件成功 / M件失敗(失敗分は選択したまま)」+先頭の失敗メッセージを表示し、手動で閉じられる。失敗行のみ選択を残して再実行可能
- 月送り・種別/状態フィルタ変更時は選択と結果をリセット(onChangeで明示実行)し、非表示行への誤操作を防止。選択対象は「表示中かつdraft」の派生集合なので、リロード後に確定・削除された行は自然に対象外となる
- `pnpm install --frozen-lockfile` — 成功
- `pnpm lint` — 合格(warning 1件: 既存の receipts-screen `<img>` のみ)
- `pnpm test` — 合格(37ファイル483件、skip 10)
- `pnpm build` — 合格
- Firebase Emulator tests — 未実施(Issue制約でEmulator起動禁止。rules・サーバー書き込み経路の変更なし)
- 一括操作は draft のみ対象とし、confirmed はIssue仕様どおり選択不可(確定データの一括変更は個別操作に限定)。締め済みは `status === "locked"` で判定(締め処理は期間内draft残存を拒否するため、closed期間内のdraftは存在しない)
- `react-hooks/set-state-in-effect` が有効なため、選択リセットは useEffect ではなく各フィルタの onChange から呼ぶ方式とした
- 一括処理は全件トランザクションではなく行ごとの逐次呼出しで部分失敗を許容(既存のCSV取込/明細インポートと同設計)。実行中はチェック・操作類を disabled にして選択の変更を防ぐ
- 行ごとの既存操作(確定・AI提案・編集・削除)は無変更。展開行の colSpan は canEdit 時 7/非表示時 6 に調整
- E2E・単体テストの一括操作カバレッジは別タスク(UIは新規パターンのため既存テストで担保される範囲外)
