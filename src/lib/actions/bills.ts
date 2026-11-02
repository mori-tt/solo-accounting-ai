"use server";

import {
  registerBill,
  registerBillPayment,
  updateBill,
} from "@/lib/accounting/services/bills";
import { assertDateString } from "@/lib/accounting/dates";
import type {
  Bill,
  BillPayment,
  Transaction,
} from "@/lib/accounting/types";
import {
  rankBillPaymentLinkCandidates,
  type BillPaymentLinkCandidate,
} from "@/lib/bill-matching";
import { listBillPaymentsRaw } from "@/lib/api/queries";
import {
  actionReadRateLimiter,
  actionWriteRateLimiter,
} from "@/lib/api/rate-limit";
import { ApiError, fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  billPaymentSchema,
  billSchema,
  parseForm,
  type BillInput,
  type BillPaymentInput,
} from "@/lib/validation/schemas";

export interface BillRow {
  bill: Bill;
  /** 支払履歴(日付昇順)。消込状態の表示・取引リンクに使う */
  payments: BillPayment[];
  paidAmount: number;
  remaining: number;
  /** 支払期日を過ぎているか(未払のみ意味を持つ) */
  overdue: boolean;
}

/**
 * 受領請求書の一覧(支払額・残額つき)。
 * 未払は期日昇順(支払予定)、支払済みは期日降順で返す。
 */
export async function listBillRows(
  businessId: string,
  asOf: string,
): Promise<ActionResult<BillRow[]>> {
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const asOfDate = assertDateString(asOf, "asOf");
    const store = getStore();
    const [bills, payments] = await Promise.all([
      store.listBills(businessId),
      listBillPaymentsRaw(businessId),
    ]);
    const paymentsByBill = new Map<string, BillPayment[]>();
    for (const p of payments as unknown as BillPayment[]) {
      const list = paymentsByBill.get(p.billId) ?? [];
      list.push(p);
      paymentsByBill.set(p.billId, list);
    }
    const rows = bills.map((bill) => {
      const list = (paymentsByBill.get(bill.id) ?? []).sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
      );
      const paidAmount = list.reduce((sum, p) => sum + p.amount, 0);
      return {
        bill,
        payments: list,
        paidAmount,
        remaining: bill.totalAmount - paidAmount,
        overdue: bill.status !== "paid" && bill.dueDate <= asOfDate,
      };
    });
    rows.sort((a, b) => {
      const aUnpaid = a.bill.status === "paid" ? 1 : 0;
      const bUnpaid = b.bill.status === "paid" ? 1 : 0;
      if (aUnpaid !== bUnpaid) return aUnpaid - bUnpaid;
      return aUnpaid === 0
        ? a.bill.dueDate.localeCompare(b.bill.dueDate)
        : b.bill.dueDate.localeCompare(a.bill.dueDate);
    });
    return rows;
  });
}

/** 受領請求書の登録 */
export async function createBill(
  businessId: string,
  input: BillInput & { idempotencyKey: string },
): Promise<ActionResult<Bill>> {
  const parsed = parseForm(billSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { bill } = await registerBill(getStore(), businessId, actor, {
      idempotencyKey: input.idempotencyKey,
      vendorName: parsed.data.vendorName,
      totalAmount: parsed.data.totalAmount,
      receivedDate: parsed.data.receivedDate,
      dueDate: parsed.data.dueDate,
      description: parsed.data.description || undefined,
    });
    return bill;
  });
}

/** 受領請求書の編集(未払のみ) */
export async function updateBillAction(
  businessId: string,
  billId: string,
  input: BillInput,
): Promise<ActionResult<Bill>> {
  const parsed = parseForm(billSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { bill } = await updateBill(getStore(), businessId, actor, billId, {
      vendorName: parsed.data.vendorName,
      totalAmount: parsed.data.totalAmount,
      receivedDate: parsed.data.receivedDate,
      dueDate: parsed.data.dueDate,
      description: parsed.data.description || undefined,
    });
    return bill;
  });
}

export interface BillPaymentLinkCandidatesResult {
  /** 取引先名(候補グルーピングの判定済み結果と合わせて画面表示に使う) */
  vendorName: string;
  candidates: BillPaymentLinkCandidate<Transaction>[];
}

/**
 * 支払に紐付ける支出取引の候補一覧。
 * 請求書の受領日〜asOf(画面側は当日)の expense 取引を対象に、
 * 既に他の支払へ紐付いた取引を除き、同じ取引先(counterparty一致)を先頭に並べる。
 */
export async function listBillPaymentLinkCandidates(
  businessId: string,
  billId: string,
  asOf: string,
): Promise<ActionResult<BillPaymentLinkCandidatesResult>> {
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const endDate = assertDateString(asOf, "asOf");
    const store = getStore();
    const bill = await store.getBill(businessId, billId);
    if (!bill) {
      throw new ApiError("NOT_FOUND", "請求書が見つかりません");
    }
    const vendorName = bill.vendorName;
    const startDate =
      bill.receivedDate <= endDate ? bill.receivedDate : endDate;
    const [transactions, payments] = await Promise.all([
      store.listTransactionsInRange(businessId, startDate, endDate),
      listBillPaymentsRaw(businessId),
    ]);
    // 他の支払に紐付いた取引は候補から外す(二重消込の防止)
    const linkedIds = new Set<string>();
    for (const p of payments as { transactionId?: string }[]) {
      if (p.transactionId) linkedIds.add(p.transactionId);
    }
    const candidates = rankBillPaymentLinkCandidates(
      transactions.filter((t) => t.type === "expense"),
      vendorName,
      linkedIds,
    );
    return { vendorName, candidates };
  });
}

/** 支払の記録と消込 */
export async function registerBillPaymentAction(
  businessId: string,
  input: BillPaymentInput & { idempotencyKey: string },
): Promise<ActionResult<{ bill: Bill }>> {
  const parsed = parseForm(billPaymentSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const store = getStore();
    const transactionId = parsed.data.transactionId || undefined;
    if (transactionId !== undefined) {
      const transaction = await store.getTransaction(
        businessId,
        transactionId,
      );
      if (!transaction) {
        throw new ApiError("INVALID_INPUT", "指定された取引が見つかりません");
      }
      if (transaction.type !== "expense") {
        throw new ApiError(
          "INVALID_INPUT",
          "支払に紐付けられるのは支出取引のみです",
        );
      }
    }
    const { bill } = await registerBillPayment(store, businessId, actor, {
      idempotencyKey: input.idempotencyKey,
      billId: parsed.data.billId,
      date: parsed.data.date,
      amount: parsed.data.amount,
      transactionId,
    });
    return { bill };
  });
}
