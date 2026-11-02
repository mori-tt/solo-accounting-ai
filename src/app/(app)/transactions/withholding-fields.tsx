"use client";

import { computeWithholdingTax } from "@/lib/accounting/domain/withholding";
import type {
  WithholdingCategory,
  WithholdingRecord,
} from "@/lib/accounting/types";
import { formatYen } from "@/lib/format";
import type { WithholdingFormInput } from "@/lib/validation/schemas";
import { Field, NumberInput, Select, TextInput } from "@/components/ui";

/**
 * 源泉徴収の入力欄(取引フォーム・経費登録フォームで共用)。
 * 対象は支出取引のみ。報酬・料金等は10.21%等で自動計算、
 * 給与は源泉徴収税額表依存のため手入力のみ。
 */

export interface WithholdingFieldsValue {
  /** 源泉徴収の対象にするか(対象フラグ) */
  enabled: boolean;
  category: WithholdingCategory;
  /** 対象支払額(入力中の文字列) */
  paymentAmount: string;
  calculation: "auto" | "manual";
  /** manual時の源泉徴収税額(入力中の文字列) */
  taxAmount: string;
  /** 支払調書の細目欄メモ */
  note: string;
}

/** 既存レコードからフォーム初期値を組み立てる */
export function initialWithholdingFields(
  record: WithholdingRecord | null | undefined,
  defaultPaymentAmount: string,
): WithholdingFieldsValue {
  if (!record) {
    return {
      enabled: false,
      category: "service_fee",
      paymentAmount: defaultPaymentAmount,
      calculation: "auto",
      taxAmount: "",
      note: "",
    };
  }
  return {
    enabled: true,
    category: record.category,
    paymentAmount: String(record.paymentAmount),
    calculation: record.calculation,
    taxAmount:
      record.calculation === "manual" ? String(record.taxAmount) : "",
    note: record.note ?? "",
  };
}

/**
 * フォーム値をスキーマ入力へ変換する。
 * 無効時は null(=記録の解除)。給与区分は自動計算不可のため manual に揃える。
 */
export function withholdingInputFrom(
  value: WithholdingFieldsValue,
): WithholdingFormInput | null {
  if (!value.enabled) return null;
  const manual =
    value.category === "salary" || value.calculation === "manual";
  return {
    category: value.category,
    paymentAmount: Number(value.paymentAmount || 0),
    calculation: manual ? "manual" : "auto",
    taxAmount: manual ? Number(value.taxAmount || 0) : undefined,
    note: value.note || undefined,
  };
}

function autoTaxPreview(value: WithholdingFieldsValue): number | null {
  const payment = Number(value.paymentAmount);
  if (!Number.isInteger(payment) || payment <= 0) return null;
  try {
    return computeWithholdingTax(payment, value.category);
  } catch {
    return null;
  }
}

export function WithholdingFields({
  value,
  defaultPaymentAmount,
  onChange,
}: {
  value: WithholdingFieldsValue;
  /** 対象を有効化したとき対象支払額へ入れる既定値(取引額) */
  defaultPaymentAmount: string;
  onChange: (next: WithholdingFieldsValue) => void;
}) {
  const isAuto =
    value.enabled &&
    value.category === "service_fee" &&
    value.calculation === "auto";
  const preview = isAuto ? autoTaxPreview(value) : null;
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) =>
            onChange({
              ...value,
              enabled: e.target.checked,
              // 有効化時に対象支払額が未入力なら取引額で埋める
              paymentAmount: e.target.checked
                ? value.paymentAmount || defaultPaymentAmount
                : value.paymentAmount,
            })
          }
        />
        源泉徴収の対象にする
      </label>
      {value.enabled && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="支払区分">
            <Select
              value={value.category}
              onChange={(e) => {
                const category = e.target.value as WithholdingCategory;
                onChange({
                  ...value,
                  category,
                  // 給与は税額表依存で自動計算できないため手入力に揃える
                  calculation:
                    category === "salary" ? "manual" : value.calculation,
                });
              }}
            >
              <option value="service_fee">報酬・料金等</option>
              <option value="salary">給与</option>
            </Select>
          </Field>
          <Field
            label="対象支払額(円)"
            hint="金額のうち源泉徴収の対象となる額"
          >
            <NumberInput
              value={value.paymentAmount}
              min={1}
              step={1}
              required
              onChange={(e) =>
                onChange({ ...value, paymentAmount: e.target.value })
              }
            />
          </Field>
          {value.category === "service_fee" && (
            <Field
              label="税額の計算"
              hint="100万円以下は10.21%、超過分は20.42%"
            >
              <Select
                value={value.calculation}
                onChange={(e) =>
                  onChange({
                    ...value,
                    calculation: e.target.value as "auto" | "manual",
                  })
                }
              >
                <option value="auto">自動計算</option>
                <option value="manual">手入力</option>
              </Select>
            </Field>
          )}
          {isAuto ? (
            <Field label="源泉徴収税額" hint="自動計算の結果">
              <p className="py-2 text-sm">
                {preview !== null ? formatYen(preview) : "―"}
              </p>
            </Field>
          ) : (
            <Field
              label="源泉徴収税額(円)"
              hint={
                value.category === "salary"
                  ? "源泉徴収税額表の税額を入力"
                  : undefined
              }
            >
              <NumberInput
                value={value.taxAmount}
                min={0}
                step={1}
                required
                onChange={(e) =>
                  onChange({ ...value, taxAmount: e.target.value })
                }
              />
            </Field>
          )}
          <Field label="細目メモ(任意)" hint="支払調書の細目欄に使用">
            <TextInput
              value={value.note}
              onChange={(e) => onChange({ ...value, note: e.target.value })}
              placeholder="例: 原稿料"
            />
          </Field>
        </div>
      )}
    </div>
  );
}
