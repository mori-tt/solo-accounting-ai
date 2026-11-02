import { assertDateString } from "../dates";
import { assertTaxAmountConsistent } from "../domain/tax";
import { TAX_CATEGORIES } from "../domain/validate";
import { DomainError } from "../errors";
import { assertYenAmount } from "../money";
import type {
  AccountingReader,
  AccountingStore,
  PutOp,
} from "../store/types";
import type {
  Expense,
  TaxCategory,
  Transaction,
} from "../types";
import {
  assertDateInOpenPeriod,
  assertTransactionEditable,
  auditsFor,
  newId,
  nowOf,
  scopedIdempotencyKey,
  type ActorContext,
} from "./common";
import {
  planWithholdingRecord,
  type WithholdingInput,
} from "./withholding";

export interface RegisterExpenseInput {
  id?: string;
  /** リトライ安全のため必須 */
  idempotencyKey: string;
  /** 仕訳日 YYYY-MM-DD */
  date: string;
  /** 円・整数・正数 */
  amount: number;
  account: string;
  counterparty?: string;
  description?: string;
  taxCategory: TaxCategory;
  /** 消費税額(円・整数・0以上) */
  taxAmount?: number;
  /** 支払期日 YYYY-MM-DD(未払管理する場合) */
  paymentDueDate?: string;
  /** 源泉徴収の記録(任意)。withholdingRecords に同一コミットで記録する */
  withholding?: WithholdingInput;
}

/**
 * 経費の登録。Transaction(type=expense) と Expense を同一コミットで作成する。
 * paymentDueDate を付けて paidAt 未設定のものは未払経費として検出できる。
 */
export async function registerExpense(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterExpenseInput,
): Promise<{ transaction: Transaction; expense: Expense; replayed: boolean }> {
  const date = assertDateString(input.date);
  const amount = assertYenAmount(input.amount);
  if (typeof input.account !== "string" || input.account.trim() === "") {
    throw new DomainError("INVALID_INPUT", "account is required");
  }
  if (
    input.counterparty !== undefined &&
    typeof input.counterparty !== "string"
  ) {
    throw new DomainError("INVALID_INPUT", "counterparty must be a string");
  }
  if (
    input.description !== undefined &&
    typeof input.description !== "string"
  ) {
    throw new DomainError("INVALID_INPUT", "description must be a string");
  }
  if (!TAX_CATEGORIES.includes(input.taxCategory)) {
    throw new DomainError(
      "INVALID_INPUT",
      `invalid taxCategory: ${String(input.taxCategory)}`,
    );
  }
  const taxAmount = input.taxAmount ?? 0;
  assertTaxAmountConsistent(input.taxCategory, amount, taxAmount);
  const paymentDueDate = input.paymentDueDate
    ? assertDateString(input.paymentDueDate, "paymentDueDate")
    : undefined;

  const expenseId = input.id ?? newId();
  const transactionId = newId();
  const at = nowOf(actor);

  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: scopedIdempotencyKey("expense", input.idempotencyKey) },
    async (tx) => {
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(date, periods);

      const transaction: Transaction = {
        id: transactionId,
        type: "expense",
        date,
        amount,
        account: input.account,
        counterparty: input.counterparty ?? "",
        description: input.description ?? "",
        receiptIds: [],
        status: "draft",
        createdBy: actor.uid,
        createdAt: at,
        updatedAt: at,
      };
      const expense: Expense = {
        id: expenseId,
        transactionId,
        taxCategory: input.taxCategory,
        taxAmount,
        paymentDueDate,
      };
      const puts: PutOp[] = [
        { collection: "transactions", id: transactionId, data: transaction },
        { collection: "expenses", id: expenseId, data: expense },
      ];
      const auditTargets = [
        { collection: "transactions", id: transactionId },
        { collection: "expenses", id: expenseId },
      ];
      // 源泉徴収対象の支出は記録を取引と同一コミットで作成する
      if (input.withholding !== undefined) {
        const record = planWithholdingRecord(
          transaction,
          input.withholding,
          actor,
          at,
        );
        puts.push({
          collection: "withholdingRecords",
          id: transactionId,
          data: record,
        });
        auditTargets.push({
          collection: "withholdingRecords",
          id: transactionId,
        });
      }
      return {
        batch: {
          puts,
          audits: auditsFor(businessId, auditTargets, "create", actor),
        },
        value: { transaction, expense },
      };
    },
  );
  return { ...value, replayed };
}

/** 経費を支払済みにする。paidAt は支払日(YYYY-MM-DD)。 */
export async function markExpensePaid(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  expenseId: string,
  paidAt: string,
): Promise<{ expense: Expense }> {
  const paidDate = assertDateString(paidAt, "paidAt");

  const { value } = await store.transact(businessId, {}, async (tx) => {
    const expense = await tx.getExpense(businessId, expenseId);
    if (!expense) {
      throw new DomainError("NOT_FOUND", `expense ${expenseId} not found`);
    }
    if (expense.paidAt !== undefined) {
      if (expense.paidAt === paidDate) {
        return { batch: { puts: [], audits: [] }, value: expense };
      }
      throw new DomainError(
        "ALREADY_PAID",
        `expense ${expenseId} is already paid at ${expense.paidAt}`,
      );
    }
    const transaction = await tx.getTransaction(
      businessId,
      expense.transactionId,
    );
    if (!transaction) {
      throw new DomainError(
        "NOT_FOUND",
        `transaction ${expense.transactionId} not found`,
      );
    }
    // 経費データは取引の属する期間の一部なので、取引日・支払日の両方を検査する
    await assertTransactionEditable(tx, businessId, transaction);
    const periods = await tx.listFiscalPeriods(businessId);
    assertDateInOpenPeriod(paidDate, periods);

    const next: Expense = { ...expense, paidAt: paidDate };
    return {
      batch: {
        puts: [{ collection: "expenses", id: expenseId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "expenses", id: expenseId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { expense: value };
}

export interface UnpaidExpense {
  expense: Expense;
  transaction?: Transaction;
  /** paymentDueDate を基準日が過ぎているか */
  overdue: boolean;
}

/**
 * 未払経費の検出。paidAt 未設定の経費を返す。
 * asOf(YYYY-MM-DD)より paymentDueDate が過去なら overdue=true。
 */
export async function findUnpaidExpenses(
  reader: AccountingReader,
  businessId: string,
  asOf: string,
): Promise<UnpaidExpense[]> {
  const asOfDate = assertDateString(asOf, "asOf");
  const expenses = await reader.listUnpaidExpenses(businessId);
  const result: UnpaidExpense[] = [];
  for (const expense of expenses) {
    const transaction = await reader.getTransaction(
      businessId,
      expense.transactionId,
    );
    result.push({
      expense,
      transaction,
      overdue:
        expense.paymentDueDate !== undefined &&
        expense.paymentDueDate <= asOfDate,
    });
  }
  return result;
}
