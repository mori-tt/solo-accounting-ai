"use server";

import {
  buildFamilySalarySlips,
  buildPaymentRecordReport,
  calendarYearRange,
  type FamilySalarySlipReport,
  type PaymentRecordReport,
} from "@/lib/accounting/domain/withholding";
import type { Transaction, WithholdingRecord } from "@/lib/accounting/types";
import { actionReadRateLimiter } from "@/lib/api/rate-limit";
import { ApiError, fail, run, type ActionResult } from "@/lib/api/result";
import { requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";

/**
 * 源泉徴収の Server Actions(参照系)。
 * 支払調書・源泉徴収票は確定済みTransactionからその場で集計し、
 * 集計値は保存しない(手計算値の保存禁止・帳票の二重管理防止)。
 * 書き込みは取引の登録/更新/削除アクションに統合されている
 * (withholdingRecords は取引の付属データとして同一コミットで管理)。
 */

function validCalendarYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2200;
}

/** 取引編集フォーム用。取引に紐付く源泉徴収記録を返す(無ければ null)。 */
export async function getWithholdingRecordForTransaction(
  businessId: string,
  transactionId: string,
): Promise<ActionResult<WithholdingRecord | null>> {
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    return (
      (await getStore().getWithholdingRecord(businessId, transactionId)) ??
      null
    );
  });
}

export interface WithholdingRow {
  record: WithholdingRecord;
  /** リンク先の取引(削除済み等で無い場合 undefined) */
  transaction?: Transaction;
}

/**
 * 源泉徴収記録の一覧(暦年範囲)。記録とリンク先取引を結合して返す。
 * 一覧には draft/期間外も含めず、記録があって取引が暦年内のものを返す。
 */
export async function listWithholdingRows(
  businessId: string,
  calendarYear: number,
): Promise<ActionResult<WithholdingRow[]>> {
  if (!validCalendarYear(calendarYear)) {
    return fail("INVALID_INPUT", "年が不正です");
  }
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const store = getStore();
    const { startDate, endDate } = calendarYearRange(calendarYear);
    const [records, transactions] = await Promise.all([
      store.listWithholdingRecords(businessId),
      store.listTransactionsInRange(businessId, startDate, endDate),
    ]);
    const txById = new Map(transactions.map((t) => [t.id, t]));
    const rows: WithholdingRow[] = [];
    for (const record of records) {
      const transaction = txById.get(record.transactionId);
      if (transaction === undefined) continue;
      rows.push({ record, transaction });
    }
    rows.sort((a, b) =>
      (a.transaction?.date ?? "").localeCompare(b.transaction?.date ?? ""),
    );
    return rows;
  });
}

export interface PaymentRecordReportData {
  businessName: string;
  report: PaymentRecordReport;
}

/**
 * 支払調書集計(報酬・料金等)。暦年・支払先別に支払額と源泉徴収税額を集計する。
 * 対象は service_fee 区分の記録が紐付く確定済み支出取引。
 */
export async function getPaymentRecordReport(
  businessId: string,
  calendarYear: number,
): Promise<ActionResult<PaymentRecordReportData>> {
  if (!validCalendarYear(calendarYear)) {
    return fail("INVALID_INPUT", "年が不正です");
  }
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const store = getStore();
    const { startDate, endDate } = calendarYearRange(calendarYear);
    const [business, transactions, records] = await Promise.all([
      store.getBusiness(businessId),
      store.listTransactionsInRange(businessId, startDate, endDate),
      store.listWithholdingRecords(businessId),
    ]);
    if (!business) {
      throw new ApiError("NOT_FOUND", "事業が見つかりません");
    }
    return {
      businessName: business.name,
      report: buildPaymentRecordReport(transactions, records, calendarYear),
    };
  });
}

export interface FamilySalarySlipReportData {
  businessName: string;
  /** 発行者名(帳票の支払者欄)。未設定は事業名 */
  issuerName: string;
  /** 発行者住所(設定されている場合) */
  issuerAddress?: string;
  report: FamilySalarySlipReport;
}

/**
 * 専従者給与の源泉徴収票データ。暦年の給与支払いを支払を受ける者別に
 * 集計し、給与所得控除後の金額と源泉徴収税額を算出する。
 */
export async function getFamilySalarySlipReport(
  businessId: string,
  calendarYear: number,
): Promise<ActionResult<FamilySalarySlipReportData>> {
  if (!validCalendarYear(calendarYear)) {
    return fail("INVALID_INPUT", "年が不正です");
  }
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const store = getStore();
    const { startDate, endDate } = calendarYearRange(calendarYear);
    const [business, transactions, records] = await Promise.all([
      store.getBusiness(businessId),
      store.listTransactionsInRange(businessId, startDate, endDate),
      store.listWithholdingRecords(businessId),
    ]);
    if (!business) {
      throw new ApiError("NOT_FOUND", "事業が見つかりません");
    }
    const issuerAddress = business.issuerAddress?.trim();
    return {
      businessName: business.name,
      issuerName: business.issuerName?.trim() || business.name,
      ...(issuerAddress ? { issuerAddress } : {}),
      report: buildFamilySalarySlips(transactions, records, calendarYear),
    };
  });
}
