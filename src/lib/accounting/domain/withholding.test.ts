import { describe, expect, it } from "vitest";
import {
  buildFamilySalarySlips,
  buildPaymentRecordReport,
  calendarYearRange,
  computeSalaryIncomeDeduction,
  computeWithholdingTax,
  UNNAMED_PAYEE,
  type WithholdingRecordLike,
  type WithholdingTxLike,
} from "./withholding";
import type { TransactionStatus, TransactionType } from "../types";

function tx(
  id: string,
  date: string,
  amount: number,
  opts: {
    type?: TransactionType;
    account?: string;
    counterparty?: string;
    status?: TransactionStatus;
  } = {},
): WithholdingTxLike {
  return {
    id,
    type: opts.type ?? "expense",
    date,
    amount,
    account: opts.account ?? "outsourcing",
    counterparty: opts.counterparty ?? "",
    status: opts.status ?? "confirmed",
  };
}

function record(
  transactionId: string,
  opts: Partial<WithholdingRecordLike> = {},
): WithholdingRecordLike {
  return {
    transactionId,
    category: "service_fee",
    paymentAmount: 100_000,
    taxAmount: 10_210,
    ...opts,
  };
}

describe("computeWithholdingTax", () => {
  it("100万円以下は10.21%(1円未満切り捨て)", () => {
    expect(computeWithholdingTax(100_000, "service_fee")).toBe(10_210);
    expect(computeWithholdingTax(98_765, "service_fee")).toBe(
      Math.floor((98_765 * 1021) / 10000),
    );
    expect(computeWithholdingTax(1_000_000, "service_fee")).toBe(102_100);
  });

  it("100万円超の部分は20.42%を加算する", () => {
    // 1,000,000 + 100,000 → 102,100 + 20,420 = 122,520
    expect(computeWithholdingTax(1_100_000, "service_fee")).toBe(122_520);
  });

  it("給与は自動計算できない", () => {
    expect(() => computeWithholdingTax(100_000, "salary")).toThrow(
      /cannot be computed/,
    );
  });

  it("非整数・非正数を拒否する", () => {
    expect(() => computeWithholdingTax(0, "service_fee")).toThrow();
    expect(() => computeWithholdingTax(-1, "service_fee")).toThrow();
    expect(() => computeWithholdingTax(1.5, "service_fee")).toThrow();
  });
});

describe("computeSalaryIncomeDeduction", () => {
  it("給与所得控除の基準値(令和2年以降の表)", () => {
    expect(computeSalaryIncomeDeduction(0)).toBe(550_000);
    expect(computeSalaryIncomeDeduction(1_625_000)).toBe(550_000);
    // 1,625,001〜1,800,000: 4割-10万
    expect(computeSalaryIncomeDeduction(1_700_000)).toBe(
      Math.floor((1_700_000 * 4) / 10) - 100_000,
    );
    // 1,800,001〜3,600,000: 3割+8万
    expect(computeSalaryIncomeDeduction(3_000_000)).toBe(980_000);
    // 3,600,001〜6,600,000: 2割+44万
    expect(computeSalaryIncomeDeduction(5_000_000)).toBe(1_440_000);
    // 6,600,001〜8,500,000: 1割+110万
    expect(computeSalaryIncomeDeduction(7_000_000)).toBe(1_800_000);
    // 8,500,001〜: 195万(上限)
    expect(computeSalaryIncomeDeduction(10_000_000)).toBe(1_950_000);
  });
});

describe("calendarYearRange", () => {
  it("暦年の範囲を返す", () => {
    expect(calendarYearRange(2026)).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
  });

  it("非整数を拒否する", () => {
    expect(() => calendarYearRange(2026.5)).toThrow();
  });
});

describe("buildPaymentRecordReport", () => {
  it("支払先別に支払額・税額を集計する", () => {
    const txs = [
      tx("t1", "2026-04-10", 100_000, { counterparty: "外注A" }),
      tx("t2", "2026-05-01", 50_000, { counterparty: "外注A" }),
      tx("t3", "2026-06-01", 80_000, { counterparty: "外注B" }),
    ];
    const records = [
      record("t1", { paymentAmount: 100_000, taxAmount: 10_210 }),
      record("t2", { paymentAmount: 50_000, taxAmount: 5_105 }),
      record("t3", { paymentAmount: 80_000, taxAmount: 8_168, note: "原稿料" }),
    ];
    const report = buildPaymentRecordReport(txs, records, 2026);
    expect(report.payees).toHaveLength(2);
    const a = report.payees.find((p) => p.payee === "外注A");
    expect(a?.paymentTotal).toBe(150_000);
    expect(a?.taxTotal).toBe(15_315);
    expect(a?.count).toBe(2);
    const b = report.payees.find((p) => p.payee === "外注B");
    expect(b?.rows[0]?.note).toBe("原稿料");
    expect(report.totalPayment).toBe(230_000);
    expect(report.totalTax).toBe(23_483);
    expect(report.excludedCount).toBe(0);
  });

  it("下書き・期間外・salary区分・リンク切れは対象外として数える", () => {
    const txs = [
      tx("draft", "2026-04-10", 100_000, { status: "draft" }),
      tx("last-year", "2025-12-10", 100_000),
      tx("locked", "2026-03-01", 100_000, { status: "locked" }),
    ];
    const records = [
      record("draft"),
      record("last-year"),
      record("locked"),
      record("ghost"),
      record("salary-tx", { category: "salary" }),
      record("open", { taxAmount: 1_000 }),
    ];
    const report = buildPaymentRecordReport(txs, records, 2026);
    // locked取引は確定済みとして集計に含む
    expect(report.payees).toHaveLength(1);
    // draft・期間外・リンク切れ(ghost/open)の4件。
    // salary区分は対象レポート外で除外カウントに含めない
    expect(report.excludedCount).toBe(4);
  });

  it("locked取引は確定済みとして集計に含む", () => {
    const txs = [
      tx("t1", "2026-10-15", 100_000, {
        counterparty: "外注A",
        status: "locked",
      }),
    ];
    const report = buildPaymentRecordReport(txs, [record("t1")], 2026);
    expect(report.payees).toHaveLength(1);
    expect(report.excludedCount).toBe(0);
  });

  it("取引先未設定は代替名にまとめる", () => {
    const txs = [tx("t1", "2026-04-10", 100_000)];
    const report = buildPaymentRecordReport(txs, [record("t1")], 2026);
    expect(report.payees[0]?.payee).toBe(UNNAMED_PAYEE);
  });
});

describe("buildFamilySalarySlips", () => {
  it("専従者給与科目の取引を支払者別に集計する", () => {
    const txs = [
      tx("s1", "2026-01-25", 80_000, {
        account: "family_salary",
        counterparty: "配偶者",
      }),
      tx("s2", "2026-02-25", 80_000, {
        account: "family_salary",
        counterparty: "配偶者",
      }),
      // 他科目の支出は対象外
      tx("o1", "2026-02-10", 30_000, { account: "supplies" }),
    ];
    const records = [
      record("s1", { category: "salary", taxAmount: 0 }),
      record("s2", { category: "salary", taxAmount: 0 }),
    ];
    const report = buildFamilySalarySlips(txs, records, 2026);
    expect(report.slips).toHaveLength(1);
    const slip = report.slips[0];
    expect(slip?.payee).toBe("配偶者");
    expect(slip?.grossAmount).toBe(160_000);
    // 162.5万以下 → 控除55万 → 控除後0(下限)
    expect(slip?.deductionAmount).toBe(550_000);
    expect(slip?.netAmount).toBe(0);
    expect(slip?.taxAmount).toBe(0);
    expect(slip?.rows).toHaveLength(2);
  });

  it("salary区分のレコードがある取引はカスタム科目でも拾う", () => {
    const txs = [
      tx("s1", "2026-03-25", 100_000, {
        account: "custom_pay",
        counterparty: "子",
      }),
    ];
    const records = [
      record("s1", { category: "salary", taxAmount: 1_000 }),
    ];
    const report = buildFamilySalarySlips(txs, records, 2026);
    expect(report.slips).toHaveLength(1);
    expect(report.slips[0]?.taxAmount).toBe(1_000);
  });

  it("期間外・下書きは集計しない", () => {
    const txs = [
      tx("s1", "2025-12-25", 80_000, {
        account: "family_salary",
        counterparty: "配偶者",
      }),
      tx("s2", "2026-01-25", 80_000, {
        account: "family_salary",
        counterparty: "配偶者",
        status: "draft",
      }),
    ];
    const report = buildFamilySalarySlips(txs, [], 2026);
    expect(report.slips).toHaveLength(0);
  });
});
