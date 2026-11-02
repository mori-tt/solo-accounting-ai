import type { DateRange } from "@/lib/accounting/domain/fiscal";
import type {
  ConsumptionTaxFiling,
  ConsumptionTaxRate,
  FilingTaxableAmounts,
  SimplifiedBusinessClass,
} from "@/lib/accounting/domain/tax";
import type { TaxMode } from "@/lib/accounting/types";
import { formatDateJP, formatYen } from "@/lib/format";

/** 簡易課税のみなし仕入率(表示用)。domain/tax.ts の DEEMED_PURCHASE_FRACTIONS と対応 */
const DEEMED_PURCHASE_RATE_LABELS: Record<SimplifiedBusinessClass, number> = {
  1: 90,
  2: 80,
  3: 70,
  4: 60,
  5: 50,
  6: 40,
};

function breakdownFor(filing: ConsumptionTaxFiling, rate: ConsumptionTaxRate) {
  return filing.breakdown.find((b) => b.rate === rate);
}

function sumAmounts(
  amounts: readonly FilingTaxableAmounts[],
  rate: ConsumptionTaxRate,
  pick: (a: FilingTaxableAmounts) => number | undefined,
): number {
  let total = 0;
  for (const a of amounts) {
    if (a.rate === rate) total += pick(a) ?? 0;
  }
  return total;
}

function ModeLabel({
  mode,
  businessClass,
}: {
  mode: TaxMode;
  businessClass?: SimplifiedBusinessClass;
}) {
  if (mode === "special20") {
    return <>2割特例(インボイス制度移行措置)</>;
  }
  if (mode === "simple" && businessClass !== undefined) {
    return (
      <>
        簡易課税(第{businessClass}種・みなし仕入率
        {DEEMED_PURCHASE_RATE_LABELS[businessClass]}%)
      </>
    );
  }
  return <>{mode === "standard" ? "本則課税" : "簡易課税"}</>;
}

/**
 * 消費税申告用の納付税額計算シート。
 * 課税標準額→消費税額(国税)→仕入税額控除→差引税額→納付税額(国税+地方消費税)
 * の順に、付表・第二表の手順に沿った様式風レイアウトで表示する。
 * 画面プレビューと印刷(@media print)の両方で使う。
 * 公式様式の転記用資料であり、e-Tax提出用フォーマットそのものではない。
 */
export function ConsumptionTaxSheet({
  businessName,
  range,
  mode,
  businessClass,
  amounts,
  filing,
}: {
  businessName: string;
  /** 会計年度の期間範囲 */
  range: DateRange;
  mode: TaxMode;
  /** 簡易課税の事業区分。mode=simple のとき必須 */
  businessClass?: SimplifiedBusinessClass;
  /** 税率別の課税対価・仕入対価(税込) */
  amounts: readonly FilingTaxableAmounts[];
  filing: ConsumptionTaxFiling;
}) {
  const standard = breakdownFor(filing, "standard");
  const reduced = breakdownFor(filing, "reduced");
  const refundable = filing.balance < 0;

  return (
    <div className="print-sheet mx-auto max-w-3xl border border-zinc-300 bg-white p-8 text-zinc-900 shadow-sm">
      <h1 className="text-center text-lg font-bold tracking-wide">
        消費税及び地方消費税 納付税額計算シート
      </h1>
      <div className="mt-4 flex items-end justify-between text-xs">
        <span>{businessName}</span>
        <span>
          自 {formatDateJP(range.startDate)} 至{" "}
          {formatDateJP(range.endDate)}
        </span>
      </div>
      <p className="mt-1 text-right text-xs">
        課税方式: <ModeLabel mode={mode} businessClass={businessClass} />
      </p>

      <table className="print-table mt-2 w-full border-collapse text-sm [&_td]:border [&_td]:border-zinc-400 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-zinc-400 [&_th]:px-2 [&_th]:py-1">
        <thead>
          <tr className="bg-zinc-100">
            <th className="w-3/4 text-left font-medium">項目</th>
            <th className="text-right font-medium">金額</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-zinc-50">
            <td colSpan={2} className="text-xs font-semibold">
              課税標準額の計算
            </td>
          </tr>
          <tr>
            <td className="pl-4">課税資産の譲渡等の対価の額(税込・10%)</td>
            <td className="text-right tabular-nums">
              {formatYen(sumAmounts(amounts, "standard", (a) => a.salesYen))}
            </td>
          </tr>
          <tr>
            <td className="pl-4">課税資産の譲渡等の対価の額(税込・軽減8%)</td>
            <td className="text-right tabular-nums">
              {formatYen(sumAmounts(amounts, "reduced", (a) => a.salesYen))}
            </td>
          </tr>
          <tr>
            <td className="pl-4">
              課税標準額(千円未満切捨て・10%)
            </td>
            <td className="text-right tabular-nums">
              {formatYen(standard?.taxableBase ?? 0)}
            </td>
          </tr>
          <tr>
            <td className="pl-4">
              課税標準額(千円未満切捨て・軽減8%)
            </td>
            <td className="text-right tabular-nums">
              {formatYen(reduced?.taxableBase ?? 0)}
            </td>
          </tr>
          <tr className="font-medium">
            <td>課税標準額の合計</td>
            <td className="text-right tabular-nums">
              {formatYen(filing.totalTaxableBase)}
            </td>
          </tr>

          <tr className="bg-zinc-50">
            <td colSpan={2} className="text-xs font-semibold">
              消費税額(国税)の計算
            </td>
          </tr>
          <tr>
            <td className="pl-4">消費税額(課税標準額×7.8%・10%分)</td>
            <td className="text-right tabular-nums">
              {formatYen(standard?.nationalTax ?? 0)}
            </td>
          </tr>
          <tr>
            <td className="pl-4">消費税額(課税標準額×6.24%・軽減8%分)</td>
            <td className="text-right tabular-nums">
              {formatYen(reduced?.nationalTax ?? 0)}
            </td>
          </tr>
          <tr className="font-medium">
            <td>消費税額の合計</td>
            <td className="text-right tabular-nums">
              {formatYen(filing.nationalTax)}
            </td>
          </tr>

          <tr className="bg-zinc-50">
            <td colSpan={2} className="text-xs font-semibold">
              仕入税額控除
            </td>
          </tr>
          {mode === "simple" ? (
            <tr>
              <td className="pl-4">
                みなし仕入率による控除額(消費税額×
                {businessClass !== undefined
                  ? `${DEEMED_PURCHASE_RATE_LABELS[businessClass]}%・第${businessClass}種`
                  : "-"}
                )
              </td>
              <td className="text-right tabular-nums">
                {formatYen(filing.deductibleInputTax)}
              </td>
            </tr>
          ) : mode === "special20" ? (
            <tr>
              <td className="pl-4">
                控除対象仕入税額(2割特例・消費税額×80%)
              </td>
              <td className="text-right tabular-nums">
                {formatYen(filing.deductibleInputTax)}
              </td>
            </tr>
          ) : (
            <>
              <tr>
                <td className="pl-4">
                  課税仕入れ等に係る支払対価の額(税込・10%)
                </td>
                <td className="text-right tabular-nums">
                  {formatYen(
                    sumAmounts(amounts, "standard", (a) => a.purchasesYen),
                  )}
                </td>
              </tr>
              <tr>
                <td className="pl-4">
                  課税仕入れ等に係る支払対価の額(税込・軽減8%)
                </td>
                <td className="text-right tabular-nums">
                  {formatYen(
                    sumAmounts(amounts, "reduced", (a) => a.purchasesYen),
                  )}
                </td>
              </tr>
              <tr>
                <td className="pl-4">控除対象仕入税額(10%分)</td>
                <td className="text-right tabular-nums">
                  {formatYen(standard?.deductibleInputTax ?? 0)}
                </td>
              </tr>
              <tr>
                <td className="pl-4">控除対象仕入税額(軽減8%分)</td>
                <td className="text-right tabular-nums">
                  {formatYen(reduced?.deductibleInputTax ?? 0)}
                </td>
              </tr>
              <tr className="font-medium">
                <td>控除対象仕入税額の合計</td>
                <td className="text-right tabular-nums">
                  {formatYen(filing.deductibleInputTax)}
                </td>
              </tr>
            </>
          )}
          <tr className="font-medium">
            <td>差引税額(消費税額 - 控除対象仕入税額)</td>
            <td className="text-right tabular-nums">
              {formatYen(filing.balance)}
            </td>
          </tr>

          <tr className="bg-zinc-50">
            <td colSpan={2} className="text-xs font-semibold">
              {refundable ? "還付税額" : "納付税額"}
            </td>
          </tr>
          {refundable ? (
            <>
              <tr>
                <td className="pl-4">還付税額(消費税・国税)</td>
                <td className="text-right tabular-nums">
                  {formatYen(filing.nationalTaxRefundable)}
                </td>
              </tr>
              <tr>
                <td className="pl-4">譲渡割額(地方消費税の還付分)</td>
                <td className="text-right tabular-nums">
                  {formatYen(filing.localTaxRefundable)}
                </td>
              </tr>
              <tr className="bg-zinc-100 font-semibold">
                <td>還付税額の合計</td>
                <td className="text-right tabular-nums">
                  {formatYen(
                    filing.nationalTaxRefundable + filing.localTaxRefundable,
                  )}
                </td>
              </tr>
            </>
          ) : (
            <>
              <tr>
                <td className="pl-4">
                  納付税額(消費税・国税、百円未満切捨て)
                </td>
                <td className="text-right tabular-nums">
                  {formatYen(filing.nationalTaxPayable)}
                </td>
              </tr>
              <tr>
                <td className="pl-4">
                  地方消費税(差引税額×22/78、百円未満切捨て)
                </td>
                <td className="text-right tabular-nums">
                  {formatYen(filing.localTaxPayable)}
                </td>
              </tr>
              <tr className="bg-zinc-100 font-semibold">
                <td>納付税額の合計(国税+地方消費税)</td>
                <td className="text-right tabular-nums">
                  {formatYen(filing.totalPayable)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <p className="mt-3 text-[10px] text-zinc-400">
        ※ 本帳票は消費税及び地方消費税の申告書(第二表)の手順を参考にした
        転記用の内部資料です。金額は税込の確定済み取引からの概算で、
        確定データには保存されません。中間納付額・割戻し計算の個別明細・
        加算税等は含みません。
        {mode === "simple" &&
          " みなし仕入率は画面上の選択値で、実際の事業区分と異なる場合は申告前に確認してください。"}
        {mode === "special20" &&
          " 2割特例は免税事業者が適格請求書発行事業者の登録により課税事業者になった場合の経過措置で、適用は2023/10/1〜2026/9/30の日の属する課税期間に限られます。登録によらず課税事業者の場合等、適用要件は申告前に確認してください。"}
      </p>
    </div>
  );
}
