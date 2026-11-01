"use client";

import { useState } from "react";
import type { TaxCategory, Transaction } from "@/lib/accounting/types";
import type { ConsumptionTaxRate } from "@/lib/accounting/domain/tax";
import { accountLabel, accountOptionsFor } from "@/lib/accounts";
import {
  parseForm,
  transactionSchema,
  type TransactionInput,
} from "@/lib/validation/schemas";
import { todayDateString } from "@/lib/format";
import {
  Alert,
  Button,
  Field,
  formIssuesMessage,
  NumberInput,
  Select,
  TextInput,
  Textarea,
} from "@/components/ui";

const TYPE_OPTIONS = [
  { value: "expense", label: "支出" },
  { value: "income", label: "収入" },
  { value: "transfer", label: "振替" },
] as const;

/**
 * 消費税区分の選択肢。課税は税率で分岐するため
 * taxCategory + taxRate を1つの select 値に畳み込む。
 */
const TAX_OPTIONS = [
  { value: "", label: "未指定" },
  { value: "taxable:standard", label: "課税(10%)" },
  { value: "taxable:reduced", label: "課税(軽減8%)" },
  { value: "non_taxable", label: "非課税" },
  { value: "out_of_scope", label: "不課税(対象外)" },
  { value: "exempt", label: "免税" },
] as const;
type TaxOptionValue = (typeof TAX_OPTIONS)[number]["value"];

function taxOptionValueOf(t?: Transaction): TaxOptionValue {
  if (!t?.taxCategory) return "";
  if (t.taxCategory === "taxable") {
    return t.taxRate === "reduced" ? "taxable:reduced" : "taxable:standard";
  }
  return t.taxCategory;
}

/** select 値をスキーマ入力へ変換。未指定は null(=クリア)を送る */
function taxFieldsFrom(value: TaxOptionValue): {
  taxCategory: TaxCategory | null;
  taxRate: ConsumptionTaxRate | null;
} {
  if (value === "") return { taxCategory: null, taxRate: null };
  if (value === "taxable:standard") {
    return { taxCategory: "taxable", taxRate: "standard" };
  }
  if (value === "taxable:reduced") {
    return { taxCategory: "taxable", taxRate: "reduced" };
  }
  return { taxCategory: value, taxRate: null };
}

/** 取引の新規登録・編集フォーム(draft/confirmedのみ) */
export function TransactionForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Transaction;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (input: TransactionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState<Transaction["type"]>(
    initial?.type ?? "expense",
  );
  const [date, setDate] = useState(initial?.date ?? todayDateString());
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : "",
  );
  const [account, setAccount] = useState(initial?.account ?? "");
  const [counterparty, setCounterparty] = useState(
    initial?.counterparty ?? "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [taxOption, setTaxOption] = useState<TaxOptionValue>(
    taxOptionValueOf(initial),
  );
  const [error, setError] = useState<string>();

  const accounts = accountOptionsFor(type);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      type,
      date,
      amount: Number(amount),
      account,
      counterparty: counterparty || undefined,
      description: description || undefined,
      ...taxFieldsFrom(taxOption),
    };
    const parsed = parseForm(transactionSchema, input);
    if (!parsed.success) {
      setError(formIssuesMessage(parsed.issues));
      return;
    }
    setError(undefined);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="種別">
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as Transaction["type"]);
              setAccount("");
            }}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="日付">
          <TextInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <Field label="金額(円)">
          <NumberInput
            value={amount}
            min={1}
            step={1}
            placeholder="例: 12000"
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="勘定科目">
          <Select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            required
          >
            <option value="">選択してください</option>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.label}
              </option>
            ))}
            {account &&
              !accounts.some((a) => a.code === account) && (
                <option value={account}>{accountLabel(account)}</option>
              )}
          </Select>
        </Field>
        <Field label="消費税区分">
          <Select
            value={taxOption}
            onChange={(e) => setTaxOption(e.target.value as TaxOptionValue)}
          >
            {TAX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="取引先">
          <TextInput
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            placeholder="例: 〇〇商店"
          />
        </Field>
        <Field label="摘要">
          <Textarea
            rows={1}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例: 備品購入"
          />
        </Field>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </form>
  );
}
