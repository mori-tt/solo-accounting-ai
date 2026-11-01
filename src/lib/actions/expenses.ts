"use server";

import {
  markExpensePaid,
  registerExpense,
} from "@/lib/accounting/services/expenses";
import type { Expense, Transaction } from "@/lib/accounting/types";
import { fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  expenseSchema,
  parseForm,
  type ExpenseInput,
} from "@/lib/validation/schemas";

export interface ExpenseRow {
  expense: Expense;
  transaction?: Transaction;
}

/** 経費一覧(対応するTransactionを結合して返す) */
export async function listExpenseRows(
  businessId: string,
): Promise<ActionResult<ExpenseRow[]>> {
  return run(async () => {
    await requireViewer(businessId);
    const store = getStore();
    const expenses = await store.listExpenses(businessId);
    const rows: ExpenseRow[] = [];
    for (const expense of expenses) {
      const transaction = await store.getTransaction(
        businessId,
        expense.transactionId,
      );
      rows.push({ expense, transaction });
    }
    rows.sort((a, b) =>
      (b.transaction?.date ?? "").localeCompare(a.transaction?.date ?? ""),
    );
    return rows;
  });
}

/** 経費の登録。Transaction(expense) と Expense を同一コミットで作成。 */
export async function createExpense(
  businessId: string,
  input: ExpenseInput & { idempotencyKey: string },
): Promise<ActionResult<{ transaction: Transaction; expense: Expense }>> {
  const parsed = parseForm(expenseSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const result = await registerExpense(getStore(), businessId, actor, {
      idempotencyKey: input.idempotencyKey,
      date: parsed.data.date,
      amount: parsed.data.amount,
      account: parsed.data.account,
      counterparty: parsed.data.counterparty,
      description: parsed.data.description,
      taxCategory: parsed.data.taxCategory,
      taxAmount: parsed.data.taxAmount,
      paymentDueDate:
        parsed.data.paymentDueDate === "" ? undefined : parsed.data.paymentDueDate,
    });
    return { transaction: result.transaction, expense: result.expense };
  });
}

/** 経費を支払済みにする */
export async function markExpensePaidAction(
  businessId: string,
  expenseId: string,
  paidAt: string,
): Promise<ActionResult<Expense>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { expense } = await markExpensePaid(
      getStore(),
      businessId,
      actor,
      expenseId,
      paidAt,
    );
    return expense;
  });
}
