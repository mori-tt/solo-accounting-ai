"use client";

import { useState } from "react";
import { useApp } from "@/components/auth-provider";
import { useApiData } from "@/lib/hooks/use-api-data";
import { useBrowserOnly } from "@/lib/hooks/use-browser-only";
import {
  createExpense,
  listExpenseRows,
  markExpensePaidAction,
} from "@/lib/actions/expenses";
import { callApi } from "@/lib/api-client";
import { accountOptionsFor, accountLabel } from "@/lib/accounts";
import { todayDateString } from "@/lib/format";
import { expenseSchema, parseForm } from "@/lib/validation/schemas";
import type { TaxCategory } from "@/lib/accounting/types";
import {
  Alert,
  Amount,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  issuesByField,
  LoadingBlock,
  NumberInput,
  PageHeader,
  Select,
  TextInput,
  Textarea,
  tableClass,
} from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";

const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  taxable: "課税仕入",
  non_taxable: "非課税",
  exempt: "免税",
  out_of_scope: "不課税(対象外)",
};

export function ExpensesScreen() {
  useBrowserOnly();
  const { businessId, business } = useApp();
  const canEdit = business?.role !== "viewer";

  const [date, setDate] = useState(todayDateString());
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [description, setDescription] = useState("");
  const [taxCategory, setTaxCategory] = useState<TaxCategory>("taxable");
  const [taxAmount, setTaxAmount] = useState("");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string>();
  const [payingId, setPayingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>();

  const { data, initialLoading, error: loadError, reload } = useApiData(
    () => callApi(() => listExpenseRows(businessId ?? "")),
    [businessId],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      date,
      amount: Number(amount),
      account,
      counterparty: counterparty || undefined,
      description: description || undefined,
      taxCategory,
      taxAmount: taxAmount === "" ? undefined : Number(taxAmount),
      paymentDueDate: paymentDueDate === "" ? undefined : paymentDueDate,
    };
    const parsed = parseForm(expenseSchema, input);
    if (!parsed.success) {
      setFieldErrors(issuesByField(parsed.issues));
      return;
    }
    setBusy(true);
    setError(undefined);
    setFieldErrors({});
    setDoneMessage(undefined);
    try {
      await callApi(() =>
        createExpense(businessId ?? "", {
          ...parsed.data,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      setDoneMessage(
        "経費を下書きとして登録しました。取引一覧で内容を確認して確定してください。",
      );
      setAmount("");
      setCounterparty("");
      setDescription("");
      setTaxAmount("");
      setPaymentDueDate("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (expenseId: string) => {
    setPayingId(expenseId);
    setActionError(undefined);
    try {
      await callApi(() =>
        markExpensePaidAction(businessId ?? "", expenseId, todayDateString()),
      );
      reload();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "更新に失敗しました",
      );
    } finally {
      setPayingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="経費登録"
        description="経費は取引(支出)と経費明細を同時に登録します。金額は円単位の整数です"
      />

      {canEdit ? (
        <Card className="mb-6">
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="日付" error={fieldErrors.date}>
                <TextInput
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="金額(円)" error={fieldErrors.amount}>
                <NumberInput
                  value={amount}
                  min={1}
                  step={1}
                  placeholder="例: 5500"
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </Field>
              <Field label="勘定科目" error={fieldErrors.account}>
                <Select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  required
                >
                  <option value="">選択してください</option>
                  {accountOptionsFor("expense").map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="取引先" error={fieldErrors.counterparty}>
                <TextInput
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                  placeholder="例: 〇〇商店"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="消費税区分" error={fieldErrors.taxCategory}>
                <Select
                  value={taxCategory}
                  onChange={(e) =>
                    setTaxCategory(e.target.value as TaxCategory)
                  }
                >
                  {Object.entries(TAX_CATEGORY_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="消費税額(円・任意)" error={fieldErrors.taxAmount}>
                <NumberInput
                  value={taxAmount}
                  min={0}
                  step={1}
                  onChange={(e) => setTaxAmount(e.target.value)}
                />
              </Field>
              <Field
                label="支払期日(任意)"
                hint="未払管理する場合に入力"
                error={fieldErrors.paymentDueDate}
              >
                <TextInput
                  type="date"
                  value={paymentDueDate}
                  onChange={(e) => setPaymentDueDate(e.target.value)}
                />
              </Field>
              <Field label="摘要" error={fieldErrors.description}>
                <Textarea
                  rows={1}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </div>
            {fieldErrors._form && (
              <Alert tone="error">{fieldErrors._form}</Alert>
            )}
            {error && <Alert tone="error">{error}</Alert>}
            {doneMessage && <Alert tone="info">{doneMessage}</Alert>}
            <div>
              <Button type="submit" loading={busy}>
                経費を登録する
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Alert tone="info" className="mb-4">
          閲覧ロールのため登録はできません
        </Alert>
      )}

      <h2 className="mb-3 text-sm font-semibold">登録済みの経費</h2>
      {actionError && (
        <Alert tone="error" className="mb-3">
          {actionError}
        </Alert>
      )}
      {loadError ? (
        <ErrorState message={loadError} onRetry={reload} />
      ) : initialLoading ? (
        <LoadingBlock />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="経費がまだありません"
          description={
            canEdit ? "上のフォームから登録してください" : undefined
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>日付</th>
                <th>科目</th>
                <th>取引先</th>
                <th className="text-right">金額</th>
                <th>消費税</th>
                <th>支払状況</th>
                <th>取引状態</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {data.map(({ expense, transaction }) => (
                <tr key={expense.id}>
                  <td className="whitespace-nowrap">
                    {transaction?.date ?? "-"}
                  </td>
                  <td>{accountLabel(transaction?.account ?? "")}</td>
                  <td className="max-w-40 truncate">
                    {transaction?.counterparty || "-"}
                  </td>
                  <td className="text-right">
                    {transaction ? (
                      <Amount value={transaction.amount} />
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>
                    {TAX_CATEGORY_LABELS[expense.taxCategory]}
                    {expense.taxAmount > 0 && (
                      <span className="text-xs text-zinc-400">
                        {" "}
                        (税額 <Amount value={expense.taxAmount} />)
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {expense.paidAt ? (
                      <Badge tone="green">支払済 {expense.paidAt}</Badge>
                    ) : (
                      <>
                        <Badge tone="amber">未払</Badge>
                        {expense.paymentDueDate && (
                          <span className="ml-1 text-xs text-zinc-400">
                            期日 {expense.paymentDueDate}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {transaction && (
                      <StatusBadge
                        kind="transaction"
                        status={transaction.status}
                      />
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      {!expense.paidAt && transaction?.status !== "locked" && (
                        <Button
                          variant="secondary"
                          loading={payingId === expense.id}
                          onClick={() => void markPaid(expense.id)}
                        >
                          支払済にする
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
