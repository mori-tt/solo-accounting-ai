"use client";

import Link from "next/link";
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
  grossIncomeWithInventory,
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
  // 棚卸高欄は棚卸カウント(inventoryCounts)の合計を初期値として表示する。
  // 上書き保持の仕組みは専従者給与と同じ(自動値が変わると自動値へ戻る)。
  const [inventoryOverride, setInventoryOverride] = useState<{
    autoBeginning: number;
    autoEnding: number;
    beginning: string;
    ending: string;
  } | null>(null);

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

  const autoBeginning = data?.beginningInventory ?? 0;
  const autoEnding = data?.endingInventory ?? 0;
  const overrideValid =
    inventoryOverride !== null &&
    inventoryOverride.autoBeginning === autoBeginning &&
    inventoryOverride.autoEnding === autoEnding;
  const beginningInput =
    overrideValid && inventoryOverride.beginning !== ""
      ? inventoryOverride.beginning
      : autoBeginning > 0
        ? String(autoBeginning)
        : "";
  const endingInput =
    overrideValid && inventoryOverride.ending !== ""
      ? inventoryOverride.ending
      : autoEnding > 0
        ? String(autoEnding)
        : "";

  const familySalary = parseYenInput(familySalaryInput);
  const deduction = parseYenInput(deductionInput);
  const beginning = parseYenInput(beginningInput);
  const ending = parseYenInput(endingInput);
  const familySalaryError =
    familySalary === undefined ? "0円以上の整数で入力してください" : undefined;
  const deductionError =
    deduction === undefined || deduction > BLUE_RETURN_DEDUCTION_MAX
      ? `0〜${BLUE_RETURN_DEDUCTION_MAX.toLocaleString()}円で入力してください`
      : undefined;
  const inventoryError =
    beginning === undefined || ending === undefined
      ? "0円以上の整数で入力してください"
      : undefined;

  // 入力が不正なときは帳票上の適用額を0として表示する
  const appliedBeginning = inventoryError ? 0 : (beginning ?? 0);
  const appliedEnding = inventoryError ? 0 : (ending ?? 0);
  const grossIncome = data
    ? grossIncomeWithInventory(
        data.statement,
        appliedBeginning,
        appliedEnding,
      )
    : 0;
  const netIncome = data
    ? computeNetIncome({
        grossIncome,
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
            <>
              <Link
                href="/inventory"
                className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
              >
                棚卸カウントへ
              </Link>
              <Link
                href="/reports/consumption-tax"
                className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
              >
                消費税 納付税額計算へ
              </Link>
              <Button
                variant="secondary"
                onClick={() => window.print()}
                disabled={!data || !netIncome}
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
          <div className="w-44">
            <Field
              label="期首商品棚卸高(円)"
              hint="前年度の棚卸カウントを初期表示(上書き可)"
              error={beginning === undefined ? inventoryError : undefined}
            >
              <NumberInput
                value={beginningInput}
                min={0}
                step={1}
                placeholder="0"
                onChange={(e) =>
                  setInventoryOverride({
                    autoBeginning,
                    autoEnding,
                    beginning: e.target.value,
                    ending: endingInput,
                  })
                }
              />
            </Field>
          </div>
          <div className="w-44">
            <Field
              label="期末商品棚卸高(円)"
              hint="棚卸カウントを初期表示(上書き可)"
              error={ending === undefined ? inventoryError : undefined}
            >
              <NumberInput
                value={endingInput}
                min={0}
                step={1}
                placeholder="0"
                onChange={(e) =>
                  setInventoryOverride({
                    autoBeginning,
                    autoEnding,
                    beginning: beginningInput,
                    ending: e.target.value,
                  })
                }
              />
            </Field>
          </div>
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
          beginningInventory={appliedBeginning}
          endingInventory={appliedEnding}
          grossIncome={grossIncome}
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
