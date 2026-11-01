"use client";

import { useState } from "react";
import type { Transaction } from "@/lib/accounting/types";
import { accountOptionsFor } from "@/lib/accounts";
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
    };
    const parsed = parseForm(transactionSchema, input);
    if (!parsed.success) {
      setError(parsed.issues.join(" / "));
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
    <form onSubmit={submit} className="flex flex-col gap-3">
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
                <option value={account}>{account}</option>
              )}
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
