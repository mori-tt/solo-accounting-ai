# REVIEW_SECURITY.md

対象: `main...mori-tt/qa-review` 差分(PR #1 foundation マージ相当)
レビュー日: 2026-10-31

## 総評

- **Blocker: なし**
- Firestore/Storage Rules は全拒否の骨格であり、現時点で外部から到達可能な
  攻撃面は存在しない(データアクセス経路・認証UI・Route Handler が未実装)。
- 主なリスクは「この骨格のまま機能実装が進むこと」と、
  Firebase 初期化モジュールの堅牢性・設定ミス耐性に関するもの。
- XSS・認証なしアクセス・個人情報ログ出力・不正アップロードについては
  現状該当コードがなく、確認済みの問題はなし(下記「確認済み・問題なし」参照)。

---

## S1 [High] Security Rules が全拒否骨格のまま(認可ロジック未実装)

- ファイル: `firestore.rules` / `storage.rules`
- 行: `firestore.rules` L12-16(`match /{document=**} { allow read, write: if false; }`)、
  `storage.rules` L11-15(同様に全拒否)
- 問題: `docs/SECURITY_RULES.md` が定める以下の認可が未実装。
  - `businesses/{businessId}/members/{uid}` のロール(owner/editor/viewer)認可
  - 締め済み `fiscalPeriod` に属するデータの update/delete 禁止
  - `auditLogs` の append-only 化
  - `aiSuggestion` フィールドのクライアント書き込み禁止(Admin SDK のみ)
  - `members` 自身の書き込みを owner 限定にする権限昇格防止
  - Storage: `receipts/{businessId}/...` スコープ、サイズ/MIME 制限
- 影響: 現状は安全側(全拒否)だが、このまま機能実装(取引・証憑・メンバー管理)が
  進むと、businessId 越境・権限昇格・締め済み改ざんを防ぐ最後の防衛線が存在しない。
  Rules を後付けで緩める場合、過度に広い `allow` を入れるリスクが高い。
- 修正案: 機能実装と同一PRで Rules を実装し、Emulator テストで
  「非メンバー拒否 / viewer 書き込み拒否 / editor の member・期間操作拒否 /
  締め済み変更拒否 / auditLogs 改ざん拒否 / aiSuggestion 書き込み拒否」
  を検証する。`get()`/`exists()` で member ロールを確認する実装は
  `docs/SECURITY_RULES.md` の方針に従う。骨格のTODOコメント通り推測で完成させない。

## S2 [Medium] Admin SDK 初期化のフォールバックと server 境界の欠如

- ファイル: `src/lib/firebase/admin.ts`
- 行: `getAdminApp()` (L8-17)
- 問題:
  1. `import "server-only"` ガードがない。クライアントコンポーネントからの
     誤インポートをビルド時に確実に防げない。
  2. `projectId` が `GOOGLE_CLOUD_PROJECT ?? NEXT_PUBLIC_FIREBASE_PROJECT_ID
     ?? "demo-solo-accounting-ai"` と、未設定でも demo プロジェクトへ静かに
     フォールバックする。本番で環境変数を忘れると、失敗せず誤った
     プロジェクトを指し続ける。
  3. `FIRESTORE_EMULATOR_HOST` 等が本番環境に誤って設定された場合、
     Admin SDK は認証情報なしでそのホストへ接続する。emulator 利用を
     `NODE_ENV !== "production"` 等に限定するガードがない。
- 影響: Admin SDK は Security Rules を完全にバイパスする特権経路。
  設定ミス時に「意図しないプロジェクトへの特権書き込み」または
  「本番で無認証エミュレータ接続」が起き得る。機能実装後に被害が出る。
- 修正案:
  - 先頭に `import "server-only";` を追加。
  - emulator 接続を明示的な開発フラグでのみ有効化し、本番で emulator 系
    env が設定されていたら警告または失敗させる。
  - 本番で projectId が解決できない場合は throw する(demo フォールバックは
    `NODE_ENV === "development"` 時のみ)。

## S3 [Medium] Emulator 接続フラグの二重接続・途中失敗問題

- ファイル: `src/lib/firebase/client.ts`
- 行: `connectEmulators()` (L21-51)、`emulatorsConnected` (L19)
- 問題:
  1. モジュールスコープの `emulatorsConnected` を接続前に `true` にしている。
     `connectAuthEmulator` 等が途中で投げると、以降の呼び出しはすべて
     接続処理をスキップし、半接続状態が継続する。
  2. dev サーバーの Fast Refresh で本モジュールが再評価されるとフラグは
     `false` に戻るが、Firebase app/サービスインスタンスは `getApps()[0]`
     経由で生き残る。`connectFirestoreEmulator` は設定確定済みの
     Firestore に対して `FAILED_PRECONDITION` ("Firestore has already been
     started") を投げるため、HMR 後にアプリがクラッシュする
     (firebase/firestore 4.19.0 の `_setSettings` で確認済み)。
- 影響: 開発中の HMR で断続的にアプリが落ち、フルリロードまで復帰しない。
  開発体験の低下と、接続状態の不整合によるデバッグ困難化。
- 修正案: 接続済み状態を app インスタンス側に紐付ける(例: `WeakSet<FirebaseApp>`
  または app へのマーカー)。各 `connect*Emulator` 呼び出しを try/catch で
  囲み、「already started / already connected」系エラーは冪等成功として扱う。
  フラグ設定は接続完了後に行う。

## S4 [Medium] Firebase クライアント設定の未設定時フェイルが静か

- ファイル: `src/lib/firebase/config.ts`
- 行: `getFirebaseConfig()` (L16-26)
- 問題: 必須環境変数が未設定でも `""` を返す。`next build`(NODE_ENV=production)
  は `.env.development` を読まないため、本番で env を設定し忘れると
  `initializeApp({ apiKey: "", projectId: "", ... })` で初期化が「成功」し、
  以降の Firebase 呼び出しが暗号的なエラーで失敗する。
- 影響: 本番デプロイ時の設定漏れが起動時エラーにならず、実行時の不可解な
  認証/API エラーとして顕在化する。原因特定に時間がかかる。
- 修正案: `shouldUseEmulator()` が false の環境で `apiKey` / `projectId` /
  `appId` 等の必須値が空なら、不足変数名を列挙して throw する。
  emulator モードでは demo 値を許容してよい。

## S5 [Low] `parseEmulatorHost` のポート 0 / 範囲外ポートの取り扱い

- ファイル: `src/lib/firebase/config.ts`
- 行: `parseEmulatorHost()` (L36-46)
- 問題:
  1. `"localhost:"` は `Number("") === 0` により `{host:"localhost", port:0}`
     を返す(フォールバックにならない)。
  2. `"localhost:-1"` や `"localhost:99999"` も `Number.isInteger` を通り、
     不正なポートがそのまま `connect*Emulator` に渡る。
  3. `"a:8080:b"` のような余分なコロンは後半を黙って捨てる。
- 影響: 誤設定時にフォールバックではなく不正な接続先(ポート0等)が使われ、
  接続失敗の原因が分かりにくい。実害は開発環境に限定される。
- 修正案: `port <= 0 || port > 65535` または `portString === ""` を
  フォールバック扱いにする。分割数が 2 でない場合もフォールバック。

## S6 [Low] セキュリティヘッダ未設定

- ファイル: `next.config.ts`
- 行: 全体
- 問題: CSP / `X-Frame-Options` / `X-Content-Type-Options` /
  `Referrer-Policy` 等のヘッダ設定がない。
- 影響: 将来ユーザー入力(取引先名・摘要など)を表示する画面で
  反射型/蓄積型 XSS や clickjacking の緩和層が1枚少ない。
  現状は静的ページのみで実害なし。
- 修正案: `next.config.ts` の `headers()` で基本ヘッダを設定。
  CSP は Firebase Auth(emulator 含む)・Storage への接続先を
  `connect-src` に含める形で、認証実装と同時に導入する。

## S7 [Low] クライアント SDK のサーバーサイド利用に境界がない

- ファイル: `src/lib/firebase/client.ts`
- 行: 全体
- 問題: `"use client"` 相当の意図表明や server 実行ガードがない。
  client SDK はサーバーでも動くため、Server Component / Route Handler から
  誤って使われた場合に Admin SDK とクライアント SDK が混在し得る。
- 影響: サーバーでクライアント SDK を使うと Security Rules の auth コンテキストが
  曖昧になり(未認証扱い)、意図しない拒否/許可の原因になる。現状は参照元なし。
- 修正案: 利用規約をコメントで明確化し、必要なら `admin.ts` と分離した
  ディレクトリ構成(`firebase/client.ts` はクライアント専用を命名や
  lint ルールで担保)にする。

---

## 確認済み・問題なし

- **businessId 越境**: データアクセスコードがまだ存在せず、Rules も全拒否。
  越境可能な経路なし。
- **認証なしアクセス**: Route Handler / Server Action / 認証必須画面が未実装。
  公開ページは静的トップページのみ。
- **個人情報のログ出力**: ログ出力コードなし。`docs/SECURITY_RULES.md` に
  禁止方針が明記済み。
- **XSS**: `src/app/page.tsx` は静的 JSX のみ。`dangerouslySetInnerHTML` なし。
- **不正ファイルアップロード**: アップロード機能なし。Storage Rules 全拒否。
- **シークレット混入**: `.env.development` は demo-* 値のみで意図的コミット。
  `.gitignore` は `.env*` を除外し example/development のみ許可。適切。
- **`.firebaserc`**: `demo-solo-accounting-ai` のみ。誤デプロイ抑止として妥当。

## 機能実装時に再確認が必要な項目(現時点では対象コードなし)

- businessId スコープの全クエリへの強制(Rules + アプリ側の両方)
- members/{uid} の権限昇格防止(自分の role を書き換え不可)
- Storage アップロードの MIME/サイズ制限(画像/PDF 想定)
- AI 呼び出し記録の auditLogs 出力と、aiSuggestion の Admin SDK 限定
