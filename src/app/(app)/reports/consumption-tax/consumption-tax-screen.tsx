"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { getConsumptionTaxFilingData } from "../actions";
import { callApi } from "@/lib/api-client";
import { fiscalYearOf } from "@/lib/accounting/domain/fiscal";
import {
  computeConsumptionTaxFiling,
  isSpecial20ApplicablePeriod,
  SPECIAL20_APPLICABLE_PERIOD,
  type SimplifiedBusinessClass,
} from "@/lib/accounting/domain/tax";
import { formatDateJP, todayDateString } from "@/lib/format";
import {
  Alert,
  Button,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Select,
} from "@/components/ui";
import { YearNav } from "../year-nav";
import { PrintHeader } from "../print-header";
import { ConsumptionTaxSheet } from "./consumption-tax-sheet";

/** 簡易課税の事業区分選択肢(第1種〜第6種・みなし仕入率) */
const BUSINESS_CLASS_OPTIONS: readonly {
  value: SimplifiedBusinessClass;
  label: string;
}[] = [
  { value: 1, label: "第1種(卸売業)90%" },
  { value: 2, label: "第2種(小売業等)80%" },
  { value: 3, label: "第3種(製造業等)70%" },
  { value: 4, label: "第4種(その他)60%" },
  { value: 5, label: "第5種(サービス業等)50%" },
  { value: 6, label: "第6種(不動産業)40%" },
];

export function ConsumptionTaxScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const startMonth = business?.fiscalYearStartMonth ?? 1;

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const fiscalYear =
    selectedYear ?? fiscalYearOf(todayDateString(), startMonth);

  // 簡易課税の事業区分はBusinessに保持しないため画面で選択する(確定データには保存しない)
  const [businessClass, setBusinessClass] =
    useState<SimplifiedBusinessClass | null>(null);

  const { data, initialLoading, error, reload } = useApiData(
    () =>
      callApi(() => getConsumptionTaxFilingData(businessId ?? "", fiscalYear)),
    [businessId, fiscalYear],
  );

  // 2割特例は適用対象期間(2023/10-2026/9の日の属する課税期間)外なら計算しない
  const special20OutOfPeriod =
    data?.taxMode === "special20" &&
    !isSpecial20ApplicablePeriod(data.range);

  // 集計入力はサーバー取得、納付額の算出はドメイン関数を画面側で実行する
  // (事業区分の変更を再取得なしで即時反映するため。決算書画面のcomputeNetIncomeと同型)
  const filing =
    data && !special20OutOfPeriod
      ? data.taxMode === "simple" && businessClass === null
        ? null
        : computeConsumptionTaxFiling(
            data.taxMode,
            data.filingAmounts,
            data.taxMode === "simple" && businessClass !== null
              ? { businessClass }
              : data.taxMode === "special20"
                ? { period: data.range }
                : {},
          )
      : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print">
        <PageHeader
          title="消費税 納付税額計算シート"
          description="会計年度の確定済み取引から消費税・地方消費税の申告納付額を概算します"
          actions={
            <>
              <Link
                href="/reports/filing"
                className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
              >
                決算書(収支内訳書)へ
              </Link>
              <Button
                variant="secondary"
                onClick={() => window.print()}
                disabled={!filing || data?.taxMode === "exempt"}
              >
                印刷する
              </Button>
            </>
          }
        />

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <YearNav
            fiscalYear={fiscalYear}
            startMonth={startMonth}
            onChange={setSelectedYear}
          />
          {data?.taxMode === "simple" && (
            <div className="w-64">
              <Field
                label="事業区分(みなし仕入率)"
                hint="簡易課税の控除額計算に使用します"
              >
                <Select
                  value={businessClass ?? ""}
                  onChange={(e) =>
                    setBusinessClass(
                      e.target.value === ""
                        ? null
                        : (Number(e.target.value) as SimplifiedBusinessClass),
                    )
                  }
                >
                  <option value="">選択してください</option>
                  {BUSINESS_CLASS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <div className="no-print">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : initialLoading ? (
        <div className="no-print">
          <LoadingBlock />
        </div>
      ) : !data ? (
        <div className="no-print">
          <ErrorState onRetry={reload} />
        </div>
      ) : (
        <>
          {data.unclassifiedCount > 0 && (
            <div className="no-print mb-4">
              <Alert tone="warning">
                消費税区分が未指定の取引が {data.unclassifiedCount}
                件あります。これらは課税対価に含まれないため、
                納付額が実際より小さく出る可能性があります。
              </Alert>
            </div>
          )}
          {data.taxMode === "exempt" ? (
            <div className="no-print">
              <Alert tone="info">
                免税事業者のため消費税の納付義務はありません。
                課税方式は設定画面で変更できます。
              </Alert>
            </div>
          ) : special20OutOfPeriod ? (
            <div className="no-print">
              <Alert tone="warning">
                2割特例は
                {formatDateJP(SPECIAL20_APPLICABLE_PERIOD.startDate)}〜
                {formatDateJP(SPECIAL20_APPLICABLE_PERIOD.endDate)}
                の日の属する課税期間に限り適用できます。
                この会計年度({formatDateJP(data.range.startDate)}〜
                {formatDateJP(data.range.endDate)}
                )は適用期間外のため計算しません。
                課税方式は設定画面で変更できます。
              </Alert>
            </div>
          ) : !filing ? (
            <div className="no-print">
              <Alert tone="info">
                簡易課税の計算には事業区分(みなし仕入率)の選択が必要です。
              </Alert>
            </div>
          ) : (
            <>
              <PrintHeader
                title="消費税及び地方消費税 納付税額計算シート"
                period={`${formatDateJP(data.range.startDate)}〜${formatDateJP(data.range.endDate)}`}
                businessName={data.businessName}
              />
              <ConsumptionTaxSheet
                businessName={data.businessName}
                range={data.range}
                mode={data.taxMode}
                businessClass={businessClass ?? undefined}
                amounts={data.filingAmounts}
                filing={filing}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
