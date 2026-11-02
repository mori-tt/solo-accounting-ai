import type { Metadata } from "next";
import { Clause, ReviewNote } from "../clause";

export const metadata: Metadata = {
  title: "プライバシーポリシー | Solo Accounting AI",
};

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">
        プライバシーポリシー
      </h1>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
        本ページはプレースホルダー骨組みです。各項目はすべて「要法務レビュー」であり、公開前に法務確認が必要です。
      </p>

      <Clause title="前文・事業者情報">
        <ReviewNote note="事業者名・所在地・お問い合わせ窓口、ポリシーの適用範囲を記載する。" />
      </Clause>

      <Clause title="1. 取得する情報">
        <ReviewNote note="取得情報の内訳を記載する:アカウント情報(メールアドレス等)、事業情報(事業名・会計年度・課税方式)、経理データ(取引・仕訳・明細・証憑画像)、利用ログ・認証情報。" />
      </Clause>

      <Clause title="2. 利用目的">
        <ReviewNote note="サービス提供・本人確認・機能改善・サポート対応・セキュリティ確保等の利用目的を列挙する。" />
      </Clause>

      <Clause title="3. AI機能におけるデータの取扱い">
        <ReviewNote note="仕訳提案・領収書OCR等のAI機能で外部AIサービスへデータを送信する場合の範囲・目的・取扱いを記載する。AI提案と確定データは分離して管理される旨を記載する。" />
      </Clause>

      <Clause title="4. 第三者提供・業務委託">
        <ReviewNote note="Firebase(認証・Firestore・Storage・Functions)その他のクラウド事業者への処理委託、国外移転の有無、法令に基づく提供を記載する。" />
      </Clause>

      <Clause title="5. 安全管理措置">
        <ReviewNote note="アクセス制御(businessId単位の分離)、Security Rules、監査ログ等の安全管理措置の概要を記載する。" />
      </Clause>

      <Clause title="6. データの保持期間・削除">
        <ReviewNote note="経理データ・証憑・ログの保持期間、アカウント・事業削除時のデータ消去方針を記載する。" />
      </Clause>

      <Clause title="7. 利用者の権利(開示・訂正・削除)">
        <ReviewNote note="個人情報保護法に基づく開示・訂正・利用停止・削除の請求方法と対応手続きを記載する。" />
      </Clause>

      <Clause title="8. Cookie・アクセスログ">
        <ReviewNote note="セッションCookie・認証トークン・アクセスログの利用目的を記載する。" />
      </Clause>

      <Clause title="9. ポリシーの変更">
        <ReviewNote note="変更時の告知方法・効力発生時点を定める。" />
      </Clause>

      <Clause title="10. 準拠法">
        <ReviewNote note="本ポリシーの準拠法(日本法・個人情報保護法を想定)を定める。" />
      </Clause>
    </>
  );
}
