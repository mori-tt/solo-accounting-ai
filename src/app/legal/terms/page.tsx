import type { Metadata } from "next";
import { Clause, ReviewNote } from "../clause";

export const metadata: Metadata = {
  title: "利用規約 | Solo Accounting AI",
};

export default function TermsPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">利用規約</h1>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
        本ページはプレースホルダー骨組みです。条項本文はすべて「要法務レビュー」であり、公開前に法務確認が必要です。
      </p>

      <Clause title="前文">
        <ReviewNote note="本規約の適用対象・サービス概要(個人事業主・小規模事業者向け経理・決算準備・確定申告準備アプリ)を定義する前文を記載する。" />
      </Clause>

      <Clause title="第1条(適用)">
        <ReviewNote note="規約の適用範囲、利用者と事業者との契約関係、規約への同意時点を定める。" />
      </Clause>

      <Clause title="第2条(定義)">
        <ReviewNote note="「本サービス」「利用者」「事業(Business)」「経理データ」「AI提案」等の用語定義を列挙する。" />
      </Clause>

      <Clause title="第3条(利用登録・アカウント管理)">
        <ReviewNote note="登録要件、メールアドレス・パスワードの管理責任、複数事業の扱いを定める。" />
      </Clause>

      <Clause title="第4条(サービスの内容)">
        <ReviewNote note="取引管理・仕訳・証憑保管・レポート・決算チェック等の機能範囲を記載する。" />
      </Clause>

      <Clause title="第5条(AI提案機能の性質)">
        <ReviewNote note="AIによる仕訳提案・OCR結果は参考情報であり、確定仕訳は利用者自身の判断・操作による旨を明記する。AIだけで仕訳は確定されない。" />
      </Clause>

      <Clause title="第6条(料金・支払い)">
        <ReviewNote note="料金体系(無料/有料プランの有無)、支払方法、請求時期を定める。" />
      </Clause>

      <Clause title="第7条(禁止事項)">
        <ReviewNote note="不正アクセス、他事業データへの不正アクセス、リバースエンジニアリング等の禁止行為を列挙する。" />
      </Clause>

      <Clause title="第8条(データの取扱い)">
        <ReviewNote note="経理データ・証憑の帰属、バックアップ方針、データエクスポートの扱いを定める。詳細はプライバシーポリシーへ委ねる旨を記載する。" />
      </Clause>

      <Clause title="第9条(知的財産権)">
        <ReviewNote note="サービス・コンテンツの権利帰属、利用者データの権利関係を定める。" />
      </Clause>

      <Clause title="第10条(免責事項)">
        <ReviewNote note="本サービスは税務・会計の専門的助言を提供するものではない旨、AI提案の正確性・完全性を保証しない旨、申告内容の最終責任は利用者にある旨、データ損失・サービス中断に関する免責を定める。" />
      </Clause>

      <Clause title="第11条(サービスの変更・中断・終了)">
        <ReviewNote note="機能変更・メンテナンス・サービス終了時の告知方法とデータの取り扱いを定める。" />
      </Clause>

      <Clause title="第12条(利用停止・解約)">
        <ReviewNote note="規約違反時の停止措置、利用者による解約手続き、解約後のデータ取扱いを定める。" />
      </Clause>

      <Clause title="第13条(規約の変更)">
        <ReviewNote note="規約変更の手続き(告知方法・効力発生時点)を定める。" />
      </Clause>

      <Clause title="第14条(準拠法・裁判管轄)">
        <ReviewNote note="準拠法(日本法を想定)および専属的合意管轄裁判所を定める。" />
      </Clause>

      <Clause title="附則">
        <ReviewNote note="制定日・施行日を記載する。" />
      </Clause>
    </>
  );
}
