import type { Metadata } from "next";
import { ReviewNote } from "../clause";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記 | Solo Accounting AI",
};

const ROWS: { label: string; note: string }[] = [
  { label: "販売事業者名", note: "事業者の正式名称を記載する。" },
  { label: "運営責任者", note: "責任者氏名を記載する。" },
  { label: "所在地", note: "事業所の所在地を記載する。" },
  { label: "電話番号", note: "連絡先電話番号を記載する(請求時に開示する運用の場合はその旨記載)。" },
  { label: "メールアドレス", note: "問い合わせ用メールアドレスを記載する。" },
  { label: "販売価格", note: "各プランの料金(税込/税別の別)を記載する。" },
  { label: "商品代金以外の必要料金", note: "通信料その他の付帯費用の有無を記載する。" },
  { label: "支払方法・支払時期", note: "決済手段と課金タイミング(前払い/後払い、更新日)を記載する。" },
  { label: "サービス提供時期", note: "申込後の利用開始時点を記載する。" },
  { label: "返品・キャンセル・解約", note: "デジタルサービスの性質上の返金可否、解約手続き・効力発生時点、クーリングオフの扱いを記載する。" },
  { label: "動作環境", note: "対応ブラウザ等の動作環境を記載する。" },
  { label: "特別な販売条件", note: "継続課金・自動更新・無料期間等の特別条件がある場合に記載する。" },
];

export default function TokushoPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">
        特定商取引法に基づく表記
      </h1>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
        本ページはプレースホルダー骨組みです。各項目はすべて「要法務レビュー」であり、公開前に法務確認が必要です。
      </p>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.label}
                className="border-b border-zinc-200 dark:border-zinc-800"
              >
                <th className="w-40 whitespace-nowrap bg-zinc-50 px-3 py-3 text-left align-top text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  {row.label}
                </th>
                <td className="px-3 py-3 align-top">
                  <ReviewNote note={row.note} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
