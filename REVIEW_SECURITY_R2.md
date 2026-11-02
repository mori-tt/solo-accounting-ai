# REVIEW_SECURITY_R2.md

対象: `main` HEAD(89a9964 時点)の全コードベース — セキュリティレビュー ラウンド2
レビュー日: 2026-11-02
前回: `REVIEW_SECURITY.md`(2026-10-31, foundation骨格時点)

## 総評

- **High: 4件 / Medium: 17件 / Low: 多数**
- ラウンド1以降で Phase 1-5 の機能実装が出揃い、認証・認可の骨格は堅牢。
  - 全 API Route / 全 Server Action でセッション検証 + メンバーシップ/ロール確認済み
  - エラーレスポンスは固定文言で内部情報を漏らさない
  - CSP等のセキュリティヘッダ付与済み、ラウンド1の S3-S7 は概ね解消
- 一方で以下の系統的な弱点が残る:
  1. **Firestoreドキュメントのフィールド値をサーバーが無検証で信頼**する箇所
     (`storagePath`/`mimeType`)が存在し、Rules側の検証不足と結合して
     クロステナント読み取り・stored XSS に繋がる(R2-1)
  2. **Backupリストアが全コレクションへ無検証書き込み**を行い、
     auditLogs/aiSuggestions/members/locked status を含む全不変条件を迂回する(R2-2)
  3. **Rulesの締め済み保護がドキュメント単位の `status` のみ**を見る設計で、
     実際にロックされるのは transactions のみ。journalEntries/expenses 等は
     closed期間内でもクライアントSDKから変更可能(R2-3)
  4. Rules のフィールド検証は型チェック中心で、不変フィールドのピン留め・
     参照整合性・値域チェックが不足(R2-9〜R2-13)
  5. Server Actions にレート制限がなく、読み取り系も無制限(R2-18)
- client SDK は Auth のみ出荷しており通常UIはサーバー経由。ただし Firebase 設定は
  公開情報であり、正規アカウントを持つ悪意あるユーザーは client SDK / REST で
  Rules の許す範囲まで直接書き込み可能。**Rules の穴はすべてその経路から到達できる**。

---

## R2-1 [High] receipts の `storagePath`/`mimeType` をサーバーが無検証で信頼 → クロステナント読取 + stored XSS

- ファイル: `src/app/api/receipts/[receiptId]/route.ts` L26-42、
  `src/lib/ai/receipt-ocr.ts` L301(L253 のコメントは前提誤り)、
  `src/app/api/ai/receipt-ocr/route.ts` L112-117、
  根源: `firestore.rules` L160-188(`validReceipt`/`linkedTxNotLocked`)
- 問題: ダウンロード Route と OCR は `getReceipt()` で取得したドキュメントの
  `storagePath`/`mimeType` をそのまま Admin SDK `bucket.file().download()` と
  レスポンス `Content-Type` に使う。一方 rules の `validReceipt` は
  `storagePath is string` の型チェックのみで、editor は client SDK から
  任意値を create/update できる(update の `unaffected` にも含まれない)。
- 攻撃経路(いずれもeditor権限で可):
  1. `storagePath: "receipts/{被害businessId}/..."` を持つ receipt doc を自事業に作成 →
     `GET /api/receipts/{id}?businessId={自事業}` が被害事業のファイルを返す
     (Admin SDKは Storage rules をバイパス)。object path の推測は必要だが、
     元メンバー等はパスを把握し得る。
  2. `mimeType: "text/html"` + 自バケットへ HTML をアップロード
     (storage.rules の `validFile` は宣言 contentType のみ検査) →
     ダウンロード Route が `Content-Disposition: inline` で `text/html` を返し、
     アプリオリジン上で JS が実行される(`nosniff` は宣言型を信じるため無効、
     CSP の `script-src 'self' 'unsafe-inline'` でも阻止されない)。
     証憑プレビューを開いた他メンバーが被害者。
  3. 同じ `storagePath` が `ReceiptOcrResolver`(receipt-ocr.ts:301)と
     `/api/ai/receipt-ocr` POST で外部OCR/LLMへ送出される(情報流出の別経路)。
- 修正案:
  - Route・OCR 双方で `receipt.storagePath.startsWith("receipts/" + businessId + "/")`
    を検証(さらに `{receiptId}` セグメント一致まで見ると堅い)。
  - serve 時に `mimeType` を許可リストで検証し、非画像は `attachment` または
    `application/octet-stream` 化、`Content-Security-Policy: sandbox` 付与も検討。
  - rules の `validReceipt` に `storagePath.matches('^receipts/' + businessId + '/')` と
    mimeType 許可リストを追加し、`storagePath`/`fileName`/`mimeType` を update の
    `unaffected()` へ追加(パスは登録後不変であるべき)。
  - Storage オブジェクトの実バイト検証(マジックバイト)をアップロード時に行うと更に堅い。

## R2-2 [High] Backupリストアが全14コレクションへ無検証書き込み → 不変条件・監査証跡の全面迂回

- ファイル: `src/app/api/backup/route.ts` L53-97、`src/lib/backup.ts` L27-42, L90-96, L433-486
- 問題: `BACKUP_COLLECTIONS` に `members`/`auditLogs`/`aiSuggestions`/`fiscalPeriods`/
  `closingChecks`/`monthlySummaries` を含み、`restoreBusinessBackup` は
  `backupDocSchema`(idのみ検証)を通ったドキュメントを `batch.set` で** verbatim 書き込み**。
  既存IDは上書きしない merge型・`protectedUids` で actor/owner の member doc は保護、
  という防御はあるが、doc内部の全フィールドは任意。Admin SDK経由のため Rules・
  ドメイン検証・締め済みチェックをすべて迂回する。
- 影響(owner権限が前提だが、監査証跡はownerの行為を他メンバー/税務調査へ
  保証するためのものであり、以下はその信頼を破壊する):
  - `auditLogs`: 任意 `actorUid`/`action`/`createdAt` の偽造ログ
    (他人名義・過去日付の工作が検出不能)
  - `aiSuggestions`: `status:"accepted"`+`decidedBy:<他uid>` の偽造提案
    (「AI提案はAdmin SDKのみ」の精神を、内容面で破る)
  - `transactions`/`expenses`/`journalEntries`: `status:"locked"` のdoc注入
    (全経路で変更不可になる永久的な不正データ)、closed期間内dateのdoc注入、
    `aiSuggestion`/`aiSuggestionId` フィールド注入
  - `members`: `role:"owner"` のmember doc追加(inviteMemberの editor/viewer 上限を迂回し
    監査にも残らない)
  - `fiscalPeriods`(closed捏造)/`closingChecks`(resolved捏造)/`monthlySummaries`
    (集計捏造)/`receipts`(任意 storagePath → R2-1 の踏み台)
- 修正案: コレクション毎のリストア方針を設計する。
  - `auditLogs`/`monthlySummaries`/`aiSuggestions` はリストア対象外とし、
    「リストア実行」1件のみ新規ログとして記録
  - `members` は role を editor/viewer に制限し `invitedBy=actor.uid` を強制
  - データ系は rules と同じ status enum を強制(`locked` 拒否)、
    `createdBy=actor.uid`/`createdAt=now` に書き換え、
    `date` が closed 期間に入るdocを reject/skip、receipt の storagePath/mimeType を再検証

## R2-3 [High] 締め済み保護が doc単位 `status` 依存で transactions しかロックされない → Rules層での締め済み改ざん経路

- ファイル: `src/lib/accounting/services/periods.ts` L322-327(close時に
  confirmed transactions のみ `status:"locked"` 化)、
  `firestore.rules` L120-127, L143-149, L264-270, L391-394、
  `src/lib/accounting/services/common.ts` L51-101(サーバー側の期間ガード)
- 問題: `closeFiscalPeriod` がロックするのは transactions のみ。Rules は
  各doc自身の `status` のみ見て `fiscalPeriods` を参照しないため:
  - `journalEntries`/`expenses`: closed期間内でも client SDK から update/delete 可
    (rules は `resource.data.status != 'locked'` を要求するが該当docは決して
    locked にならない)。さらにサーバー実装が書く expense doc は `status` フィールドを
    持たないため偶然にも fail-close するが、client 作成docは永遠に mutable。
  - `invoices`/`payments`/`customers`/`projects`/`recurringTemplates`/`fixedAssets`:
    ロック概念自体がなく closed期間内でも自由に変更可。
  - create/update 共に「date/issueDate を closed期間内にする」ことを防ぐ規則がない
    (サーバー側の `assertDateInOpenPeriod` は全コマンド経路で担保済みだが、
    client SDK 直接書き込みを防ぐのが Rules の役目)。
- 影響: 「締め済み期間のデータを直接変更しない」不変条件が Rules層で成立していない。
  editor権限を持つ悪意あるユーザー(または client SDK を使う通常ユーザー)が
  締め後に確定仕訳・証憑リンク・台帳を改ざん可能。
- 修正案:
  - `closeFiscalPeriod` で期間内の `expenses`/`journalEntries` も `locked` にする
    (schema/types 側には既に locked 概念あり・現在は未使用)
  - invoices/payments 等の期間扱いを仕様として決めて文書化(締め対象か否か)
  - create時の「dateがclosed期間」防止は Rules では fiscalPeriodId 保持か
    サーバー強制の徹底が現実解。残存リスクとして明記するか設計を決める。

## R2-4 [High] メンバー管理でオーナーロックアウト/オーナー乗っ取りが不可逆に発生しうる

- ファイル: `src/lib/actions/businesses.ts` L171-198(inviteMember),
  L201-225(updateMemberRole), L269-286(removeMember)、
  `src/lib/api/session.ts` L60-72(ownerUidフォールバック)、`firestore.rules` L93-109
- 問題:
  - `inviteMember` は `uid === actor.uid` や `uid === business.ownerUid` の
    ガードがない。自分自身のメールを `role:"viewer"` で招待すると
    `putMember` の `set(merge)` で自分の member doc が viewer に上書きされる。
    `requireMembership` は member doc の role を優先し ownerUid フォールバックは
    doc不存在時のみ → 唯一のownerが自らを降格すると **どの経路(API/Rules)でも
    owner操作が不能になり、事業が永久的に管理不能** になる。
  - `updateMemberRole`/`removeMember` は `memberUid === actor.uid` のみ防御。
    member doc を持つ第2オーナー(rulesは `isOwner` が role:'owner' の member を
    作成可)が `business.ownerUid` の member doc を viewer に変更/削除すると
    真のオーナーは viewer 転落 → 完全乗っ取り + ロックアウト。
  - Rules 側でも owner の自己降格・自己 member 削除は許可されており不可逆。
- 影響: 管理上の不可逆的な制御喪失、複数オーナー環境での乗っ取り。
- 修正案: 3アクションとも `対象uid === business.ownerUid` を拒否
  (business doc 取得して判定)、`inviteMember` は `uid === actor.uid` も拒否。
  「少なくとも1人のownerが残る」をトランザクション内で担保すると更に堅い。
  Rules 側でも member の delete/demote に owner残存チェックの検討余地あり。

## R2-5 [Medium] 認証前にリクエストボディを全体バッファリング → 未認証でのメモリ/CPU DoS

- ファイル: `src/app/api/receipts/route.ts` L31-37、`src/app/api/backup/route.ts` L55-72、
  `src/app/api/ai/receipt-ocr/route.ts` L70-78、`src/app/api/ai/suggestions/route.ts` L55-63、
  `src/app/api/ai/suggestions/[suggestionId]/route.ts` L20-28
- 問題: `request.formData()`/`request.json()` が `require*` より先に実行され、
  ボディ全体をメモリに読む。`file.size > 10MB` チェックはバッファ後なので
  メモリ制限として機能しない。`/api/backup` の 64MB チェックは
  `content-length` ヘッダのみ見るため、chunked送信や非数値ヘッダで迂回される
  (未設定→0、非数値→NaN>上限=false)。
- 影響: 未認証リクエストで大ボディを読ませる DoS(コスト/可用性)。
- 修正案: 各 Route で `await requireUid()`(body不要な認証)をボディ解析前に行い、
  businessId依存のロール検証は解析後に維持。実バイト数の上限も
  (ストリーム読みカウント等で)強制する。

## R2-6 [Medium] `POST /api/ai/receipt-ocr` が viewer でも有償OCRを起動できる

- ファイル: `src/app/api/ai/receipt-ocr/route.ts` L78
- 問題: `requireViewer` で通し、外部OCR/LLMを呼び `aiRunRateLimiter`(60回/時)を消費。
  対になる `POST /api/ai/suggestions` は `requireEditor` で正しい。
  閲覧専用メンバーが有償API呼出と証憑の外部送出を起動できるのは
  「viewer=読み取りのみ」のロールモデルに反する。
- 修正案: `requireEditor(businessId)` に変更。

## R2-7 [Medium] レート制限キーの弱点: XFF先頭偽装・businessId乗算・未検証バケット集中

- ファイル: `src/lib/api/rate-limit.ts` L112-119, L94-159、
  `src/lib/actions/businesses.ts` L89-116
- 問題:
  1. `clientIpKey` は `x-forwarded-for` の**先頭**を使う。append型プロキシ
     (Vercel等)では `spoofed, real` の並びになり先頭は攻撃者の偽装値 →
     `/api/session` の30回/時を無限に回転して `verifyIdToken(checkRevoked)` の
     署名検証+Auth RPCコストを連打できる。
  2. XFFが剥がされる環境では全員が `"unknown"` バケットに集中し、
     グローバル30回/時でログイン全滅。
  3. AI/OCR/upload/backup の limiter は businessId キー。
     `createBusiness` に制限がなく事業は無料作成できるため、N事業でN倍の枠を獲得
     (LLM/Storageコスト悪用)。
- 修正案: プラットフォームが保証するIPヘッダ(末尾ホップ等)を使う、
  コスト発生経路に uid 単位の副次制限を追加、createBusiness に uid 単位制限。
  (インメモリ・インスタンス単位の限界はヘッダコメント通り了承済み)

## R2-8 [Medium] Storage Rules: 証憑ファイルの上書き/削除がreceipt docの状態と無連携、MIMEは宣言値のみ

- ファイル: `storage.rules` L32-48
- 問題:
  - `allow create, update: if canWrite && validFile()` — editor が既存ファイルを
    上書き(update)可能。`allow delete` も receipt doc の状態を見ないため、
    locked transaction に紐付く証憑のファイルを消せる(doc削除はrulesが拒否するが
    ファイル削除は通る)。
  - `request.resource.contentType` はクライアント宣言値のみ検査し実バイトを見ない
    (R2-1 のXSS経路の一部)。
  - アップロードRouteの許可リスト `image/heif` が storage.rules にない drift
    (Admin経由なので実害小)。
- 修正案: update/delete 時に `firestore.get()` で receipt doc を引き
  `txLocked` 相当の判定、または `status != 'unprocessed'` のreceiptのファイルは
  変更不可にする。`image/heif` の有無を Route と揃える。

## R2-9 [Medium] Rules: 不変フィールドのピン留め不足(帰属・証跡の偽造)

- ファイル: `firestore.rules`
- 問題(いずれも member/editor 権限の client SDK 書き込みで可能):
  - `fiscalPeriods` update は `startDate`/`endDate` のみピン → **`fiscalYear` の書換**
    (`fy{year}` のdoc-id規約を破壊)と **`closedBy` の偽装** が可能
  - `closingChecks` update は `resolvedBy` 不問 → editor が `resolvedBy:"<owner>"` で偽装解決
  - `journalEntries` update は `sourceType`/`sourceId` が mutable → 出所偽造
  - `aiSuggestions` update は `decidedAt` 不問 → 過去日付の決定
  - `auditLogs` create は `createdAt` 不問 → 過去日付ログ
  - `members` create/update は `invitedBy` 偽装可、`uid` フィールドが doc id と
    不一致でも書ける → `listMyBusinessIds`(collectionGroup `where uid==`)と
    `isMember`(doc id)の解釈が分岐し、幽霊member/不可視memberが作れる
- 修正案: `unaffected` リストを拡張し、status遷移時は `closedBy`/`resolvedBy`/
  `decidedBy` が `request.auth.uid` であることを要求。members は
  `request.resource.data.uid == uid` と `invitedBy == request.auth.uid` を要求。

## R2-10 [Medium] Rules: 発行済み/入金済みの請求・入金データが変更可能

- ファイル: `firestore.rules` L219-236, L240-255
- 問題: invoices の update は `createdAt` のみピン → `issued`/`paid` でも
  `customerId`/`items`/`totalAmount`/`status` が書き換え可(`paid`→`draft` 戻し含む)。
  payments は `invoiceId`/`createdAt` ピンのみで `amount`/`date`/`transactionId` が mutable。
  請求・入金履歴を事後に改竄できる。
- 修正案: status による update 制限(issued 以降は限定的フィールドのみ)と
  payment の `amount`/`date`/`transactionId` ピン留め。`totalAmount`/`amount` の
  正数チェックも追加(後述L系: 符号不検査と併せて)。

## R2-11 [Medium] Rules: 参照整合性の未検証 → 偽造docがサーバー集計を汚染

- ファイル: `firestore.rules` L152-158, L186-188, L243, L251-254, L273-279、
  `src/lib/accounting/store/firestore.ts` L152-156, L264-271、
  `src/lib/accounting/services/sales.ts` L368-391, L442-447
- 問題:
  - `payments` create は任意 `invoiceId`+任意 `amount` を受理 →
    `listPaymentsForInvoice` の paidTotal 集計に偽造paymentが混入し
    invoice を `paid` にできる
  - `expenses` create は任意 `transactionId` → `getExpenseByTransactionId` は
    hits[0] を返すため、偽造expenseが本物を shadow する
  - `receipts` の `linkedTxNotLocked` はリンク先 tx が**存在しない**場合に
    `!txLocked` で通る(exists=false)
  - `journalEntries.lines` は `is list` のみ(不平衡な仕訳が書ける)、
    `invoices.items` は未検証(サーバー `computeInvoiceTotals` が誤集計/例外)
  - `closingChecks` create は system 種別(missing_receipt等)+任意
    `fiscalPeriodId`/`targetPath` を受理(createdBy=self で偽装は防げない種類)
- 修正案: `exists()` でリンク先の実在を要求(receipts→transactionId)、
  `lines`/`items` の要素形状を最低限検証。残りの参照信頼は文書化した残存リスクとする。

## R2-12 [Medium] Rules: editor の delete が仕様より広い

- ファイル: `firestore.rules`、仕様: `docs/SECURITY_RULES.md` L34-38
- 問題: 仕様では editor の delete は transactions(draft)/invoices(draft)/
  receipts(unprocessed) のみ許可し「上記以外の削除はownerのみ」。現行は
  expenses/journalEntries(draft)、closingChecks(open)に加え、
  **customers/projects/payments/recurringTemplates/fixedAssets へ無制限の
  editor delete** を許可。記録済み入金・稼働中の固定資産の破壊が可能。
- 修正案: 仕様外コレクションの delete を owner のみ(またはstatus限定)に変更。

## R2-13 [Medium] Rules: auditLogs が viewer でも追記可能・内容が任意

- ファイル: `firestore.rules` L399-408、仕様: `docs/SECURITY_RULES.md` L23-28
- 問題: `isMember`(viewer含む)が `actorUid==self` で任意 `targetPath`・任意
  `action`(enumの `approve_ai`/`close` 等を含む)のログを追記できる →
  読み取り専用ユーザーが「AI承認」「締め実行」の偽造ログを流せる。
  またサーバーが実際に書く `run_ai`/`reject_ai` が enum にない drift。
- 修正案: create を `canEdit` に、targetPath を `^businesses/{businessId}/` に制約、
  action enum を実使用値(run_ai/reject_ai を含む)に整合、`createdAt` 必須化。

## R2-14 [Medium] `deleteTransaction` が非原子的: closeFiscalPeriod とのTOCTOU・監査抜け・参照残し

- ファイル: `src/lib/actions/transactions.ts` L166-197
- 問題: `getTransaction`(トランザクション外)→status確認→
  `deleteTransactionDoc`→`writeAuditLog` が別々の書き込み。
  1. `closeFiscalPeriod`(transact内・別doc群)が並行して lock する間に
     `status!=='locked'` チェックを通過し、locked取引が削除されうる
  2. `deleteTransactionDoc` 成功後に `writeAuditLog` が失敗すると無監査削除
  3. 関連 expense(`transactionId`)/receipt(`transactionId`)/payment
     (`transactionId`)が dangling 参照になる
- 修正案: 読み取り・チェック・削除・監査を `store.transact()` 内で行い、
  関連docの同時処理(削除または参照解除、ないし参照存在時は削除禁止)を行う。

## R2-15 [Medium] 入力検証の抜け: account無制限・updateProject無検証・items無上限等

- ファイル: `src/lib/validation/schemas.ts` L161, L195, L254、
  `src/lib/actions/sales.ts` L144-179, L333-347、
  `src/lib/actions/transactions.ts` L29-41、
  `src/lib/accounting/services/monthlySummary.ts` L30
- 問題:
  - `account` が `z.string().min(1)` のみ(長さ無制限・科目一覧照合なし)。
    任意長文字列のdoc肥大化、カスタム科目50件上限の迂回、
    `accountBreakdown` のキー汚染
  - `updateProject` は zod を通さず `input.name` に長さ上限なし
    (非object入力は TypeError→500)
  - `invoiceSchema.items` に `.max()` なし(無制限の明細配列)
  - `listTransactions` の `range` が未検証で Firestore `where()` へ直行
  - `businessSchema.allocationRatios` のキーが科目コードに制限されていない
  - 各種enum/scalar引数(`listReceipts`のstatus、`setRecurringTemplateActive`の
    active、`periodId`/`idempotencyKey`等)が未検証で INTERNAL 500 化しうる
  - `registerPaymentAction`: 消込先 transaction の存在/type チェックが
    `transact` 外(TOCTOU)かつ1取引の多重消込を防いでいない
- 修正案: `account` に `.max(50)` + サーバー側で `getAccountOptions` 照合、
  `projectUpdateSchema` 新設、itemsに `.max()`、range/enum系を parseForm へ。

## R2-16 [Medium] `idempotencyKey` がactionを跨いだ静黙リプレイを起こす

- ファイル: `src/lib/accounting/store/firestore.ts` L382-398、
  呼出側は生 `input.idempotencyKey` をそのまま使用(例: transactions.ts:57, closing.ts:73)
- 問題: キーは businessId 単位でのみ名前空間化され、recordの `value` は
  そのまま返る。別actionのキーを再利用すると `ok:true` で**無関係な古い値**
  が返り、書き込み自体がスキップされる(例: closeFiscalPeriodAction が
  createTransaction の返り値を返し、期間は閉じない)。非文字列キーは
  `createHash.update` が投げて 500。
- 修正案: record に `action` を保持し不一致時は新規実行扱いにする、
  `idempotencyKey` を schema 検証(文字列・長さ上限)。

## R2-17 [Medium] サーバー側の締め済みガードの抜け(固定資産・期首残高・期間自動作成)

- ファイル: `src/lib/accounting/services/fixedAssets.ts` L124-215、
  `src/lib/actions/opening-balances.ts` L33-41, L69-80、
  `src/lib/actions/closing.ts` L27-35
- 問題:
  - `updateFixedAsset`/`disposeFixedAsset` に `assertDateInOpenPeriod` がなく、
    closed期間内の `acquiredDate`/`disposedDate` や取得価額を事後改訂できる
    → 締め済み年度の減価償却計算結果が変わる(実質的な締め済み改ざん)
  - `closedYearKeys` が `${fiscalYear}${accountCode}${amount}` を区切りなし結合
    → `{code:"a",amount:15}` と `{code:"a1",amount:5}` が衝突し、
    closed年度の期首残高を実質変更できる
  - `ensureFiscalPeriod` が `requireEditor` で fiscalPeriods を自動作成
    (rules/SECURITY_RULES は owner のみ)。editor が任意4桁年の期間を作成可能
- 修正案: 固定資産の update/dispose に closed期間ガード、キー比較を
  `JSON.stringify` のソート済みタプルに、ensureFiscalPeriod のロール方針を
  owner化または意図的差異として明文化。

## R2-18 [Medium] Server Actionsにレート制限がなく、読み取り系も無制限(N+1含む)

- ファイル: `src/lib/actions/reports.ts` L90-153(getDashboard: 全期間読み+N+1)、
  `expenses.ts` L23-43、`search.ts` L20-48、`transactions.ts` L209-231、
  `accounts.ts` L18-30、`audit-logs.ts` L24-49、`src/app/(app)/reports/actions.ts` L101-140、
  `src/lib/accounting/services/sales.ts` L432-456, `expenses.ts` L192-214
- 問題: Route Handler には limiter があるが Server Action には一切ない。
  `getDashboard` は全期間 `listTransactionsInRange` + unpaid 検出でdoc単位の
  逐次読み(N+1)。`listExpenseRows` 等も同様。`searchTransactions` は件数上限なし。
  editor/viewer がループで Firestore read を燃やせる(コストDoS)。
- 修正案: doc単位読みの `Promise.all` 化/in句バッチ化、検索・一覧の件数上限、
  重いアクションへの uid 単位レート制限。

## R2-19 [Medium] admin.ts: S2 の未解消分 — 本番での demo projectId フォールバック、サーバー側emulator環境変数ガードがデッドコード

- ファイル: `src/lib/firebase/admin.ts` L14-20、`src/lib/env.ts` L112-123、
  `src/lib/firebase/client.ts` L15, L91
- 問題: `import "server-only"` は追加済みだが:
  1. `projectId` が `GOOGLE_CLOUD_PROJECT ?? NEXT_PUBLIC_FIREBASE_PROJECT_ID
     ?? "demo-solo-accounting-ai"` と本番でも静かに demo を向く
     (env設定忘れ時に失敗せず誤プロジェクトへ特権書き込み)
  2. `warnIfProductionWithEmulatorHost` は `assertFirebaseClientEnvOnce` 経由、
     つまり client.ts(ブラウザバンドル)からしか呼ばれず、非 `NEXT_PUBLIC_` の
     env は静的に undefined。**サーバー側で `FIRESTORE_EMULATOR_HOST` が残って
     いても警告ゼロ**で Admin SDK が無認証接続する — S2 が警告したまさにその経路
- 修正案: `getAdminApp()` で本番 projectId 未解決時に throw(demoフォールバックは
  development/emulator限定)、サーバー側でも emulator系 env の検査を呼ぶ。

## R2-20 [Medium] CSVエクスポートにスプレッドシート数式インジェクションのエスケープがない

- ファイル: `src/lib/csv.ts` L31-41(`escapeField`/`serializeCsv`)、
  `buildTransactionsCsv` L194-202
- 問題: `counterparty`/`description` はユーザー入力(500字まで)で、
  `=HYPERLINK(...)`・`=cmd|...`・先頭の `+`/`-`/`@`/タブをそのまま出力する。
  クォート囲みでも Excel は評価する。エクスポートしたCSVを開いた側が実行する。
- 修正案: テキスト列で先頭が `= + - @ \t \r` のフィールドに `'` を前置
  (escapeField で全呼出しをカバー)。

## R2-21 [Medium] expenses の Rules/ドメイン形状の不整合 → クライアント経路で書けない/テストが誤った形状を検証

- ファイル: `firestore.rules` L152-158、`src/lib/accounting/types.ts` L88-96、
  `src/lib/accounting/services/expenses.ts` L95-101、`tests/` L108-119 付近
- 問題: `validExpense` は `d.status in ['draft','confirmed']` と
  `createdBy==auth.uid` を要求するが、ドメインの `Expense` 型には `status` がなく
  `registerExpense` も書かない。つまり rules が要求する形状をアプリは生成せず、
  rules テストの fixture が双方を持つため「実在しない形状」を検証している。
  client SDK から server作成 expense を更新しようとしても
  `resource.data.status` 不存在で deny になる不整合。
- 修正案: expense に `status` を実装するか rules 側の要求を実形状に合わせる。

---

## Low(一覧)

- `(app)/error.tsx` が `error.message` をユーザー表示(他error境界はdigestのみ)
- CSV import: ファイルサイズ/行数の上限なし(タブ固着+無制限の逐次action呼出)。
  Server Action にレート制限がないため R2-18 と相乗
- `monitoring/logger.ts`: denylistがASCII英語キーのみで `摘要`/`取引先` 等の
  日本語キーが素通り、`serializeError` が error.message/stack をメールマスクのみで
  記録、`redactedKeys` に生キー名が入る。現状 logger は health のみから呼ばれ
  露出小だが、配線拡大時に要対応。逆に `run()`/`toErrorResponse` の想定外エラーは
  どこにもログされず INTERNAL 障害が不可視(安全性と可観測性のトレードオフ)
- `Strict-Transport-Security` なし(next.config.ts。本番のみ付与要)
- `assertSameOrigin` は `/api/session` のみ適用。他の mutating routes は
  `SameSite=Lax` 依存(現代ブラウザでは十分、same-siteサブドメイン経路は残存)。
  また sessionRoute はレート制限消費が origin チェックより先
- `PATCH /api/ai/suggestions/[id]`: get→decide が非原子的で二重決定が監査に残りうる
- `POST /api/receipts`: 非multipartボディで `formData()` が投げて500、
  `registerReceipt` 失敗時にStorageへorphanファイルが残る
- セッションCookie: `__Host-` プレフィックスなし、`secure` が `NODE_ENV==="production"` 依存
- `users/{uid}`: 任意フィールド書込み可(現状はauthz非依存・化粧的)
- Rules: 金額の符号未検査(`is int`のみで負額が書ける)、`dateString` は形式のみ
  (`9999-99-99` 可)、`keys()` ホワイトリストがなく任意フィールド混入可、
  `validReceipt` で `transactionId` が非stringなら `$(txId)` 補間が実行時エラー
  →fail-closeだがクラッシュ耐性として改善余地、1評価あたり exists+get の
  accessコールがバッチ/リスト評価で増えて上限到達時はdeny(fail-closed)
- `GET /api/health` の `checks.db:"skipped"` が emulator env の有無を示す(軽微)
- `GET /api/backup` の `filename` に生 businessId(自己生成IDなので実害ほぼ無)
- `listBusinessMembers`/`listMembers` が member のメールアドレスを viewer に返す
  (UI上要として意図的か要確認)
- `inviteMember` の `getUserByEmail` はアカウント存在オラクル(機能必須・留意のみ)
- `refreshOverdueInvoices` が viewer 可読の list action 内で editor/owner のみ
  実行(viewer分岐は担保済みだが、読み取り系に書き込みを同居させる構造)
- `putMember` が毎回 `createdAt`/`invitedBy` を上書き(監査的に歪)、
  business作成時の bootstrap member 書込みは監査ログなし
- `listMyBusinesses` が member role を unchecked cast(UI表示のみ・authz影響なし)
- `requireMembership` の ownerUid フォールバックは Rules の `isMember` にない
  サーバー独自挙動(意図的だが監査時に誤解を招く)
- `journalEntries`/`closingChecks` はドメインの `CollectionName` にない
  (書き込み経路がbackupのみ)のに rules が editor CRUD を許可 →
  未実装機能の形状で偽造docが書ける
- `tests/firestore/ai-suggestions.rules.test.ts` が古い複製で、member docを
  seed しない deny 断言は rules ではなく isMember 失敗で通る(誤解を招くカバレッジ)
- `parseEmulatorHost` が host の前後空白を trim しない(開発環境のみ)
- `robots.ts` の disallow に `/onboarding` がない(認証ゲート内・実害なし)
- Server Action の `email_verified` 要求は未導入(バナーのソフトゲートのみ・要検討)
- `getUserByEmail`・member email 補完等は呼出し毎に Auth RPC 数回(性能観点)

---

## 確認済み・問題なし

- **セッション**: verifyIdToken(checkRevoked=true)を発行時・全リクエストで実行、
  httpOnly+SameSite=Lax+Secure(本番)+path=/+1h、POST/DELETE とも
  sec-fetch-site/Origin による same-origin 強制、IPレート制限、16KBトークン上限
- **全 API Route / 全 Server Action** が `requireUid`/`requireViewer`/`requireEditor`/
  `requireOwner` を実行。ロールはサーバー側の member doc 由来で、
  client提供の uid/businessId/actorUid/createdBy を信頼しない
- **AI不変条件**: aiSuggestions の作成/内容は Admin SDKのみ、
  承認/却下は status解決+`decidedBy=actor.uid` のみ、AIだけで仕訳確定しない、
  `aiSuggestion`/`aiSuggestionId` フィールドは client 書き込み不可
- **マスアサイン防止**: 更新は `{...current, 許可フィールド}` 再構築 + zod strip
- **`transact` 原子性**: 読み取りが全て runTransaction 内で puts+audits+冪等を
  一括commit(超過支払い・締め時draft検査・receipt-link lock・定期/償却の冪等生成)
- **金額**: zod の int/正数 + サービス層の assertYenAmount の二重検証、
  invoice合計はサーバー再計算で client値を拒否
- **エラー**: ApiError/DomainError は固定文言、想定外は汎用 INTERNAL、
  stack/path/Firestore詳細を client に返さない。Retry-After 付き429
- **証憑アップロード**: storagePath はサーバー生成 `receipts/{biz}/{uuid}/{sanitize}`、
  fileName サニタイズで traversal なし、MIME許可リスト+10MB+per-business制限
- **client SDK の使用は Auth のみ**(getFirebaseDb/getFirebaseStorage は未使用)
  → CSP の connect-src は identitytoolkit/securetoken/authDomain で過不足なし、
  `https:` ワイルドカードなし。emulator時は client.ts と同一解決ロジック
- **ラウンド1対応の検証**: S3(マーカー方式+already系冪等+完了後フラグ)、
  S4(assertFirebaseClientEnvOnce で fail fast・失敗時非メモ化)、
  S5(ポート1-65535・分割数検証)、S6(ヘッダ付与)、S7(client-only)は解消。
  S2 は `server-only` 追加済みだが projectId/emulatorガードが未解消(R2-19)
- **open redirect**: `safeNextPath` が `/` 始まり・`//`/`\`/`/login` 自己ループを拒否
- **パスワードリセット**: user-not-found を成功扱いにして列挙不可
- **シークレット**: コミット値なし、`.gitignore` が `.env*` を適切に除外、
  `.env.development` は demo-* のみ、`.firebaserc` も demo のみ
- **Rules 検証済みの強い部分**: member bootstrap(getAfter検証で完全)、
  aiSuggestions ライフサイクル、monthlySummaries `write:if false`、
  businesses ownerUid ピン、全コレクションの catch-all なし default deny、
  `is int` が浮動小数を正しく拒否、欠損必須フィールドは fail-closed
- **バックアップの良い部分**: owner専用、既存IDはmergeで保護、未知コレクションは
  無視、protectedUids、business doc はスキーマ許可フィールドのみ

## Rules テストの不足(重要な負例が未検証)

- customers/projects/invoices/payments: describe 自体がない
  (越境・viewer書込・不変フィールド・参照ピン)
- expenses: locked経路のみ。create検証・越境・viewer・editor-draft削除境界なし
- receipts: linked lockedのみ。storagePath/mimeType検証・unprocessed削除境界・越境なし
  (R2-1 を検出するテストがない)
- transactions: フィールド検証負例(非int/負額・enum外・closed期間内date作成)なし
- members: bootstrap偽造(他人uidのmember作成・同batch複数member)・
  uid-field vs doc-id 不一致・自己降格の負例なし
- auditLogs: viewer create・任意action/targetPath/createdAt の負例なし
- fiscalPeriods: fiscalYear書換・closedBy偽造・closed作成・重複期間なし
- closingChecks: resolvedBy偽造・viewer削除・status遷移の負例なし
- storage: 上書き・locked紐付け削除・list・宣言vs実contentType・heif drift なし
- users: 任意フィールド書込みなし。idempotencyKeys の明示deny、
  businessesのlistセマンティクス、collectionGroup のテストなし

## 推奨対応順

1. R2-1: storagePath/mimeType のサーバー側 prefix/allowlist 検証 + rules 強化
   + serve 時の attachment/octet-stream 化
2. R2-4: メンバー管理の ownerUid/self ガード
3. R2-2: backup リストアのコレクション別フィルタ・検証
   (auditLogs/monthlySummaries/aiSuggestions を対象外に)
4. R2-3: closeFiscalPeriod のロック範囲拡大 + Rules の期間モデル決定
5. R2-5: 全 Route で認証前ボディ解析の排除 + 実バイト上限
6. R2-6〜R2-8: OCR editor化、レート制限キー、storage rules の doc連携
7. R2-9〜R2-13: Rules の不変フィールド・参照・delete範囲・auditLogs 修正と
   対応する負例テスト追加
8. R2-14〜R2-18: アクション原子性・入力検証・idempotency・期間ガード・読み取り制限
9. R2-19: admin.ts の本番ガード、R2-20: CSVエスケープ、R2-21: expense形状整合

---

## 対応状況(ラウンド2 修正実施分)

実施日: 2026-11-02。`security-round2` worktree にて対応。

### 修正済み

- **R2-1**: `src/lib/receipt-files.ts` に `isReceiptStoragePathOf`
  (`receipts/{businessId}/{receiptId}/{fileName}` prefix 検証)と
  `isAllowedReceiptMime`/サイズ上限を集約。ダウンロード route と
  `ReceiptOcrResolver.resolveOcrText`(共通 choke point)、
  `POST /api/receipts` で検証。serve 側も許可外 MIME は
  `application/octet-stream`+`attachment` 化、`X-Content-Type-Options:
  nosniff`・`Content-Security-Policy: default-src 'none'` を付与。
  firestore.rules 側でも `validReceipt` が businessId+receiptId 配下の
  storagePath・MIME allowlist・登録後不変を強制(rules テストで網羅)。
- **R2-2**: `planRestore` を sanitize 設計に変更。`actorUid` は認証済み実行者
  必須(バックアップ側の値は信用しない)、許可コレクションのみ・
  `idempotencyKeys`/監査証跡系は除外、status/日付/closed期間・
  owner member 注入・偽造 auditLog を復元時に拒否。
  `src/lib/backup.test.ts` で回帰テスト。
- **R2-3**: rules の `inClosedPeriod` が日付→`fy{year}`(開始月考慮)で
  期間 doc を引き、transactions 以外(journalEntries/invoices/payments/
  closingChecks/経由参照)も closed期間の作成・更新・削除を rules 層で拒否。
  固定資産側はサーバー層 `assertDateInOpenPeriod` を追加(下記 R2-17)。
- **R2-4**: `getOwnerUid()` 追加。`inviteMember`/`updateMemberRole`/
  `removeMember` で自己招待と `business.ownerUid` member の降格・削除を
  actions+rules 双方で拒否(rules テスト: 第2オーナー経由・自己降格も deny)。
- **R2-5**: `src/lib/api/body.ts` の `readRequestText(request, maxBytes)` が
  ストリームの実バイトを計測し `content-length` 偽装(chunked)を遮断。
  backup/OCR route は `requireUid()` をボディ読取前に移動。
- **R2-6**: `POST /api/ai/receipt-ocr` を editor/owner 限定化。
- **R2-7 (一部)**: `clientIpKey` を XFF 最右(プロキシ信頼側)採用へ変更
  + 事業作成に uid 単位レート制限。残: Server Action 系のスロットリング。
- **R2-8**: storage.rules に `receiptFileMutable`(doc未登録=可変、
  docありは `unprocessed` かつ紐付 tx 未締めのみ可変)。MIME allowlist に
  `image/heif` 追加、`put` 上書きが create 評価される経路も塞いだ
  (create/update 双方に適用)。rules テストで doc 状態連動を検証。
- **R2-9**: `unaffected(keys)` で `createdBy`/`createdAt`/`aiSuggestion`/
  `sourceType`/`closedBy`/`resolvedBy`/`invitedBy` 等をピン留め。
  `closedBy`/`resolvedBy`/`actorUid` は `request.auth.uid` 一致を強制。
- **R2-10**: invoices は `issued` 以降の内容・status 変更を拒否(draft のみ
  editor 削除可、それ以外は owner)。payments は実在 invoice への作成のみ +
  `invoiceId`/`amount`/`date`/`transactionId` 不変 + 削除は owner のみ。
- **R2-11**: `linkedTxExistsUnlocked`(実在+未締め)と `linkedReceiptExists`、
  payment→invoice、closingCheck→fiscalPeriod(open) の参照実在チェックを追加。
- **R2-12**: expenses/recurringTemplates/fixedAssets/customers/projects/
  journalEntries/closingChecks の delete を owner 限定へ(editor は
  transactions draft・receipts unprocessed のみ)。
- **R2-13**: auditLogs create を editor/owner・自分名義 `actorUid`・
  定義済み action enum・自事業配下 `targetPath`・`createdAt` が
  `request.time` 前後のみ(serverTimestamp想定、emulator の解決ずれを考慮して
  ±1h の範囲検証)に制限。
- **R2-14**: `CommitBatch` に `deletes` を追加し、`deleteTransaction` を
  read+権限+delete+audit を `store.transact` 内で原子実行。
- **R2-15 (一部)**: `account`/名称/items 等に上限と schema 検証を追加。
  残: account コードの科目マスタ照合・range 等の細粒度検証。
- **R2-16**: `scopedIdempotencyKey(scope, key)` を追加し、操作種別ごとに
  名前空間化(別コマンドの結果が誤 replay されない)。
- **R2-17 (一部)**: 固定資産の登録・更新・除却・償却計上に
  `assertDateInOpenPeriod` 追加。残: `closedYearKeys` の区切りなし結合衝突、
  `ensureFiscalPeriod` のロール方針(要仕様確認)。
- **R2-19**: admin.ts で本番 projectId 未解決時は throw(demo フォールバックは
  非本番限定)+ サーバー側 emulator env ガードを有効化。
- **R2-20**: `escapeField` が先頭 `=`/`+`/`-`/`@`/タブ系のフィールドに
  `'` を前置(全 CSV 出力経路をカバー)。
- **R2-21**: rules の `validExpense` をドメイン実形状に合わせ、status 欠落の
  server作成 doc は update/delete が fail-closed で deny になる挙動を
  テストで固定。

### 残件(未対応・残留リスク)

- **R2-18**: Server Actions のレート制限・N+1 読み取りの効率化は未着手
  (コストDoSの残存)。
- **R2-15 残**: 科目コード照合・range 検証など細粒度の入力検証。
- **R2-17 残**: `closedYearKeys` 結合衝突、`ensureFiscalPeriod` の owner 化。
- **R2-7 残**: Server Action のスロットリング実装。
- auditLogs の `createdAt` は ±1h 許容(emulator で serverTimestamp が
  request.time と厳密一致しないため)。本番は厳密一致でも動く想定だが
  目視確認は未実施 — 将来的に厳格化する余地あり。

### 検証状況

- `pnpm lint` — エラー0(既存 warning1件のみ)
- `pnpm typecheck` — 通過
- `pnpm test` — 549件通過
- `pnpm build` — 通過
- `pnpm test:rules`(JDK21・firestore+storage emulator)— 103件通過
  (members bootstrap・ownerUid保護・closed期間日付・invoice/payment・
  参照整合性・auditLog偽装・receipt path/MIME・storage doc連動を網羅)
- `pnpm test:emulators` — 7件通過

### Rules 実装メモ(実機で見つかった挙動)

- `rules.String.matches()` は **文字列全体一致**(部分一致ではない)。
  前方一致が必要な箇所は `/.+` を末尾に付ける
  (storagePath/targetPath で一時全拒否になった原因)。
- match ブロックの wildcard 変数は、そのブロック内で宣言された function にのみ
  見える。`validReceipt` は `receiptId` を引数で受け取る形に修正済み。
- storage の `put` 上書きは emulator で `create` 評価されることがあるため、
  `receiptFileMutable` を create/update 双方に適用した(片方だけだと
  上書きで doc 保護をすり抜ける)。update 側にだけ保護を書くと
  emulator 上で上書きを許してしまうことを実測で確認済み。
