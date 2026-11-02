import { assertDateString } from "../dates";
import { DomainError } from "../errors";
import { assertYenAmount } from "../money";
import type { AccountingReader, AccountingStore, PutOp } from "../store/types";
import type { Bill, BillPayment } from "../types";
import {
  assertDateInOpenPeriod,
  auditsFor,
  newId,
  nowOf,
  scopedIdempotencyKey,
  type ActorContext,
} from "./common";

export interface RegisterBillInput {
  id?: string;
  /** リトライ安全のため必須 */
  idempotencyKey: string;
  /** 取引先名(支払先) */
  vendorName: string;
  /** 請求額(円・整数・正数) */
  totalAmount: number;
  /** 受領日 YYYY-MM-DD */
  receivedDate: string;
  /** 支払期日 YYYY-MM-DD */
  dueDate: string;
  description?: string;
}

function assertBillFields(input: {
  vendorName: unknown;
  totalAmount: unknown;
  receivedDate: unknown;
  dueDate: unknown;
  description?: unknown;
}): { vendorName: string; totalAmount: number; receivedDate: string; dueDate: string } {
  if (typeof input.vendorName !== "string" || input.vendorName.trim() === "") {
    throw new DomainError("INVALID_INPUT", "vendorName is required");
  }
  const totalAmount = assertYenAmount(input.totalAmount, "totalAmount");
  const receivedDate = assertDateString(input.receivedDate, "receivedDate");
  const dueDate = assertDateString(input.dueDate, "dueDate");
  if (
    input.description !== undefined &&
    typeof input.description !== "string"
  ) {
    throw new DomainError("INVALID_INPUT", "description must be a string");
  }
  return { vendorName: input.vendorName, totalAmount, receivedDate, dueDate };
}

/** 受領請求書を unpaid として登録する。 */
export async function registerBill(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterBillInput,
): Promise<{ bill: Bill; replayed: boolean }> {
  const fields = assertBillFields(input);
  const id = input.id ?? newId();
  const at = nowOf(actor);

  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: scopedIdempotencyKey("bill", input.idempotencyKey) },
    async (tx) => {
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(fields.receivedDate, periods);

      const bill: Bill = {
        id,
        vendorName: fields.vendorName,
        totalAmount: fields.totalAmount,
        receivedDate: fields.receivedDate,
        dueDate: fields.dueDate,
        description: input.description,
        status: "unpaid",
        createdBy: actor.uid,
        createdAt: at,
        updatedAt: at,
      };
      return {
        batch: {
          puts: [{ collection: "bills", id, data: bill }],
          audits: auditsFor(
            businessId,
            [{ collection: "bills", id }],
            "create",
            actor,
          ),
        },
        value: bill,
      };
    },
  );
  return { bill: value, replayed };
}

export interface UpdateBillInput {
  vendorName: string;
  totalAmount: number;
  receivedDate: string;
  dueDate: string;
  description?: string;
}

/**
 * 未払の受領請求書を更新する。
 * 支払済みは消込結果との整合を保つため変更不可(支払の訂正は次の
 * オープン期間への取消しで表現する)。締め済み期間に属する請求も変更不可。
 */
export async function updateBill(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  billId: string,
  input: UpdateBillInput,
): Promise<{ bill: Bill }> {
  const fields = assertBillFields(input);

  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getBill(businessId, billId);
    if (!current) {
      throw new DomainError("NOT_FOUND", `bill ${billId} not found`);
    }
    if (current.status !== "unpaid") {
      throw new DomainError(
        "INVALID_STATUS_TRANSITION",
        `bill ${billId} is already paid`,
      );
    }
    // 支払累計を下回る請求額への変更は残高が負になり支払不能になるため拒否
    const payments = await tx.listBillPaymentsForBill(businessId, billId);
    const paidSoFar = payments.reduce((sum, p) => sum + p.amount, 0);
    if (fields.totalAmount < paidSoFar) {
      throw new DomainError(
        "INVALID_INPUT",
        `totalAmount ${fields.totalAmount} < already paid ${paidSoFar}`,
      );
    }
    const periods = await tx.listFiscalPeriods(businessId);
    assertDateInOpenPeriod(current.receivedDate, periods);
    assertDateInOpenPeriod(fields.receivedDate, periods);

    const next: Bill = {
      ...current,
      vendorName: fields.vendorName,
      totalAmount: fields.totalAmount,
      receivedDate: fields.receivedDate,
      dueDate: fields.dueDate,
      description: input.description,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [{ collection: "bills", id: billId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "bills", id: billId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { bill: value };
}

export interface RegisterBillPaymentInput {
  id?: string;
  /** リトライ安全のため必須 */
  idempotencyKey: string;
  billId: string;
  /** 支払日 YYYY-MM-DD */
  date: string;
  /** 円・整数・正数。部分支払可、超過支払は不可 */
  amount: number;
  /** 対応する支出Transaction */
  transactionId?: string;
}

/**
 * 支払の記録と消込(入金消込の買掛版)。
 * 累計支払額が請求額に達したら bill を paid にする。
 * 同時実行でも過払いにならないよう、既存支払はトランザクション内で集計する。
 */
export async function registerBillPayment(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterBillPaymentInput,
): Promise<{ payment: BillPayment; bill: Bill; replayed: boolean }> {
  const date = assertDateString(input.date);
  const amount = assertYenAmount(input.amount);

  const paymentId = input.id ?? newId();
  const at = nowOf(actor);

  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: scopedIdempotencyKey("billPayment", input.idempotencyKey) },
    async (tx) => {
      const bill = await tx.getBill(businessId, input.billId);
      if (!bill) {
        throw new DomainError(
          "NOT_FOUND",
          `bill ${input.billId} not found`,
        );
      }
      if (bill.status === "paid") {
        throw new DomainError(
          "ALREADY_PAID",
          `bill ${input.billId} is already fully paid`,
        );
      }
      const periods = await tx.listFiscalPeriods(businessId);
      assertDateInOpenPeriod(date, periods);

      const payments = await tx.listBillPaymentsForBill(
        businessId,
        input.billId,
      );
      const paidSoFar = payments.reduce((sum, p) => sum + p.amount, 0);
      if (paidSoFar + amount > bill.totalAmount) {
        throw new DomainError(
          "OVERPAID",
          `payment exceeds bill total: paid ${paidSoFar} + ${amount} > ${bill.totalAmount}`,
        );
      }

      const payment: BillPayment = {
        id: paymentId,
        billId: input.billId,
        date,
        amount,
        transactionId: input.transactionId,
        createdAt: at,
      };
      const paidTotal = paidSoFar + amount;
      const billNext: Bill = {
        ...bill,
        status: paidTotal === bill.totalAmount ? "paid" : bill.status,
        updatedAt: at,
      };
      const puts: PutOp[] = [
        { collection: "billPayments", id: paymentId, data: payment },
      ];
      const auditTargets: { collection: "billPayments" | "bills"; id: string }[] =
        [{ collection: "billPayments", id: paymentId }];
      if (billNext.status !== bill.status) {
        puts.push({
          collection: "bills",
          id: bill.id,
          data: billNext,
        });
        auditTargets.push({ collection: "bills", id: bill.id });
      }
      return {
        batch: {
          puts,
          audits: auditsFor(businessId, auditTargets, "create", actor),
        },
        value: { payment, bill: billNext },
      };
    },
  );
  return { ...value, replayed };
}

export interface UnpaidBill {
  bill: Bill;
  paidAmount: number;
  remaining: number;
  /** dueDate を基準日が過ぎているか */
  overdue: boolean;
}

/**
 * 未払の受領請求書(支払予定)の検出。
 * status=unpaid(部分支払を含む)のものを返す。
 * dueDate を基準日が過ぎているものは overdue=true で検出する。
 */
export async function findUnpaidBills(
  reader: AccountingReader,
  businessId: string,
  asOf: string,
): Promise<UnpaidBill[]> {
  const asOfDate = assertDateString(asOf, "asOf");
  const bills = await reader.listBills(businessId);
  const result: UnpaidBill[] = [];
  for (const bill of bills) {
    if (bill.status === "paid") continue;
    const payments = await reader.listBillPaymentsForBill(
      businessId,
      bill.id,
    );
    const paidAmount = payments.reduce((sum, p) => sum + p.amount, 0);
    result.push({
      bill,
      paidAmount,
      remaining: bill.totalAmount - paidAmount,
      overdue: bill.dueDate <= asOfDate,
    });
  }
  // 支払予定として期日の近い順に返す
  result.sort((a, b) => a.bill.dueDate.localeCompare(b.bill.dueDate));
  return result;
}
