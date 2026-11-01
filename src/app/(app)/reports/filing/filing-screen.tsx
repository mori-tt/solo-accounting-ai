"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import { getFilingStatement } from "../actions";
import { callApi } from "@/lib/api-client";
import { fiscalYearOf } from "@/lib/accounting/domain/fiscal";
import {
  BLUE_RETURN_DEDUCTION_MAX,
  computeNetIncome,
} from "@/lib/accounting/domain/filing";
import { todayDateString } from "@/lib/format";
import {
  Button,
  ErrorState,
  Field,
  LoadingBlock,
  NumberInput,
  PageHeader,
} from "@/components/ui";
import { YearNav } from "../year-nav";
import { FilingSheet } from "./filing-sheet";

/** 円入力のパース。空欄は0、不正値は undefined。 */
function parseYenInput(value: string): number | undefined {
  if (value === "") return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

export function FilingScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const startMonth = business?.fiscalYearStartMonth ?? 1;

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const fiscalYear =
    selectedYear ?? fiscalYearOf(todayDateString(), startMonth);

  // 専従者給与欄は family_salary 科目の年間合計を初期値として表示する。
  // state には手入力の上書きのみを保持し(自動値に紐付け)、
  // 空欄または自動値の変化(年度切替・再取得)で自動値へ戻る。
  const [salaryOverride, setSalaryOverride] = useState<{
    auto: number;
    value: string;
  } | null>(null);
  const [deductionInput, setDeductionInput] = useState("");

  const { data, initialLoading, error, reload } = useApiData(
    () => callApi(() => getFilingStatement(businessId ?? "", fiscalYear)),
    [businessId, fiscalYear],
  );

  const autoFamilySalary = data?.statement.familyEmployeeSalary ?? 0;
  const autoSalaryText = autoFamilySalary > 0 ? String(autoFamilySalary) : "";
  const familySalaryInput =
    salaryOverride !== null &&
    salaryOverride.auto === autoFamilySalary &&
    salaryOverride.value !== ""
      ? salaryOverride.value
      : autoSalaryText;

  const familySalary = parseYenInput(familySalaryInput);
  const deduction = parseYenInput(deductionInput);
  const familySalaryError =
    familySalary === undefined ? "0円以上の整数で入力してください" : undefined;
  const deductionError =
    deduction === undefined || deduction > BLUE_RETURN_DEDUCTION_MAX
      ? `0〜${BLUE_RETURN_DEDUCTION_MAX.toLocaleString()}円で入力してください`
      : undefined;

  // 入力が不正なときは帳票上の適用額を0として表示する
  const netIncome = data
    ? computeNetIncome({
        grossIncome: data.statement.grossIncome,
        familyEmployeeSalary: familySalaryError
          ? undefined
          : (familySalary ?? 0),
        blueReturnDeduction: deductionError ? undefined : (deduction ?? 0),
      })
    : null;

  return (
    <div className="mx-auto max-w-5xl">
      <style>{`
        @media print {
          aside, header, .no-print { display: none !important; }
          main { padding: 0 !important; }
          .print-sheet {
            border: none !important;
            box-shadow: none !important;
            margin: 0 !important;
            max-width: none !important;
            padding: 0 !important;
          }
        }
      `}</style>

      <div className="no-print">
        <PageHeader
          title="決算書(収支内訳書)"
          description="会計年度の年間収支を収支内訳書(一般用)の様式で確認・印刷できます"
          actions={
            <Button
              variant="secondary"
              onClick={() => window.print()}
              disabled={!data || !netIncome}
            >
              印刷する
            </Button>
          }
        />

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <YearNav
            fiscalYear={fiscalYear}
            startMonth={startMonth}
            onChange={setSelectedYear}
          />
          <div className="w-44">
            <Field
              label="専従者給与(円)"
              hint="専従者給与科目の年間合計を初期表示(上書き可)"
              error={familySalaryError}
            >
              <NumberInput
                value={familySalaryInput}
                min={0}
                step={1}
                placeholder="0"
                onChange={(e) =>
                  setSalaryOverride({
                    auto: autoFamilySalary,
                    value: e.target.value,
                  })
                }
              />
            </Field>
          </div>
          <div className="w-44">
            <Field
              label="青色申告特別控除(円)"
              hint="最大65万円(所得金額が上限)"
              error={deductionError}
            >
              <NumberInput
                value={deductionInput}
                min={0}
                max={BLUE_RETURN_DEDUCTION_MAX}
                step={1}
                placeholder="0"
                onChange={(e) => setDeductionInput(e.target.value)}
              />
            </Field>
          </div>
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
      ) : !data || !netIncome ? (
        <div className="no-print">
          <ErrorState onRetry={reload} />
        </div>
      ) : (
        <FilingSheet
          businessName={data.businessName}
          statement={data.statement}
          result={{
            ...netIncome,
            familyEmployeeSalary: familySalaryError
              ? 0
              : (familySalary ?? 0),
          }}
        />
      )}
    </div>
  );
}
