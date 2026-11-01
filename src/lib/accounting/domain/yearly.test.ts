import { describe, expect, it } from "vitest";
import {
  buildConsumptionTaxSummary,
  buildYearlyReport,
  type ExpenseTaxRecord,
  type YearlyTransaction,
} from "./yearly";

function tx(
  id: string,
  overrides: Partial<YearlyTransaction> = {},
): YearlyTransaction {
  return {
    id,
    type: "income",
    date: "2026-05-10",
    amount: 1000,
    account: "sales",
    status: "confirmed",
    ...overrides,
  };
}

describe("buildYearlyReport", () => {
  it("暦年(1月始まり)は1月〜12月の月別行を返す", () => {
    const report = buildYearlyReport(
      [
        tx("t1", { date: "2026-01-15", amount: 1000 }),
        tx("t2", {
          date: "2026-12-20",
          type: "expense",
          account: "supplies",
          amount: 400,
        }),
      ],
      2026,
      1,
    );
    expect(report.range).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(report.months).toHaveLength(12);
    expect(report.months[0].month).toBe("2026-01");
    expect(report.months[11].month).toBe("2026-12");
    expect(report.months[0].income).toBe(1000);
    expect(report.months[11].expense).toBe(400);
    expect(report.totalIncome).toBe(1000);
    expect(report.totalExpense).toBe(400);
  });

  it("4月始まりは4月〜翌3月の順で年をまたぐ", () => {
    const report = buildYearlyReport(
      [
        tx("t1", { date: "2027-03-05", amount: 3000 }),
        tx("t2", { date: "2026-04-01", amount: 500 }),
      ],
      2026,
      4,
    );
    expect(report.range).toEqual({
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    });
    expect(report.months[0].month).toBe("2026-04");
    expect(report.months[11].month).toBe("2027-03");
    expect(report.months[0].income).toBe(500);
    expect(report.months[11].income).toBe(3000);
  });

  it("draft・transfer・期間外の取引は集計しない", () => {
    const report = buildYearlyReport(
      [
        tx("t1", { status: "draft", amount: 9999 }),
        tx("t2", { type: "transfer", account: "transfer", amount: 777 }),
        tx("t3", { date: "2025-12-31", amount: 555 }),
        tx("t4", { status: "locked", amount: 100 }),
      ],
      2026,
      1,
    );
    expect(report.totalIncome).toBe(100);
    expect(report.months.every((m) => m.expense === 0)).toBe(true);
  });

  it("科目別年間合計は科目コード昇順で収支を分ける", () => {
    const report = buildYearlyReport(
      [
        tx("t1", { account: "sales", amount: 1000 }),
        tx("t2", { account: "misc_income", amount: 200 }),
        tx("t3", {
          type: "expense",
          account: "rent",
          amount: 300,
        }),
        tx("t4", {
          type: "expense",
          account: "rent",
          amount: 100,
        }),
      ],
      2026,
      1,
    );
    expect(report.accountTotals).toEqual([
      { account: "misc_income", income: 200, expense: 0 },
      { account: "rent", income: 0, expense: 400 },
      { account: "sales", income: 1000, expense: 0 },
    ]);
  });

  it("不正な年度開始月はエラーになる", () => {
    expect(() => buildYearlyReport([], 2026, 0)).toThrow();
    expect(() => buildYearlyReport([], 2026, 13)).toThrow();
  });
});

describe("buildConsumptionTaxSummary", () => {
  it("課税取引を税率別に分けて内税を推定する", () => {
    const summary = buildConsumptionTaxSummary(
      [
        tx("t1", {
          amount: 11000,
          taxCategory: "taxable",
          taxRate: "standard",
        }),
        tx("t2", {
          amount: 1080,
          taxCategory: "taxable",
          taxRate: "reduced",
        }),
        tx("t3", {
          type: "expense",
          account: "supplies",
          amount: 5500,
          taxCategory: "taxable",
          taxRate: "standard",
        }),
      ],
      [],
    );
    const standard = summary.rows.find(
      (r) => r.bucket === "taxable_standard",
    )!;
    expect(standard.sales).toBe(11000);
    expect(standard.purchases).toBe(5500);
    expect(standard.salesTax).toBe(1000); // 11000/11
    expect(standard.purchasesTax).toBe(500); // 5500/11
    const reduced = summary.rows.find(
      (r) => r.bucket === "taxable_reduced",
    )!;
    expect(reduced.sales).toBe(1080);
    expect(reduced.salesTax).toBe(80); // 1080*2/27
    expect(summary.filingAmounts).toEqual([
      { rate: "standard", salesYen: 11000, purchasesYen: 5500 },
      { rate: "reduced", salesYen: 1080, purchasesYen: 0 },
    ]);
  });

  it("取引に税区分が無いとき紐付くExpenseの区分を使い申告税額を優先する", () => {
    const expenses: ExpenseTaxRecord[] = [
      { transactionId: "t1", taxCategory: "taxable", taxAmount: 300 },
      { transactionId: "t2", taxCategory: "non_taxable", taxAmount: 0 },
    ];
    const summary = buildConsumptionTaxSummary(
      [
        tx("t1", {
          type: "expense",
          account: "rent",
          amount: 55000,
        }),
        tx("t2", {
          type: "expense",
          account: "taxes",
          amount: 4000,
        }),
      ],
      expenses,
    );
    const standard = summary.rows.find(
      (r) => r.bucket === "taxable_standard",
    )!;
    expect(standard.purchases).toBe(55000);
    expect(standard.purchasesTax).toBe(300); // 推定5000ではなく申告額
    const nonTaxable = summary.rows.find((r) => r.bucket === "non_taxable")!;
    expect(nonTaxable.purchases).toBe(4000);
    expect(nonTaxable.purchasesTax).toBe(0);
    expect(summary.unclassifiedCount).toBe(0);
  });

  it("Expense由来の課税仕入は税率未指定として標準税率に含める", () => {
    const summary = buildConsumptionTaxSummary(
      [tx("t1", { type: "expense", account: "supplies", amount: 5500 })],
      [{ transactionId: "t1", taxCategory: "taxable", taxAmount: 0 }],
    );
    const standard = summary.rows.find(
      (r) => r.bucket === "taxable_standard",
    )!;
    expect(standard.purchasesTax).toBe(500); // taxAmount未設定→内税推定
    expect(summary.filingAmounts).toEqual([
      { rate: "standard", salesYen: 0, purchasesYen: 5500 },
    ]);
  });

  it("税区分未設定は unclassified に集計して件数を返す", () => {
    const summary = buildConsumptionTaxSummary(
      [tx("t1", { amount: 1000 }), tx("t2", { amount: 500 })],
      [],
    );
    const row = summary.rows.find((r) => r.bucket === "unclassified")!;
    expect(row.sales).toBe(1500);
    expect(row.count).toBe(2);
    expect(summary.unclassifiedCount).toBe(2);
    expect(summary.filingAmounts).toEqual([]);
  });

  it("非課税・免税・不課税は税額0・draft/transferは対象外", () => {
    const summary = buildConsumptionTaxSummary(
      [
        tx("t1", { taxCategory: "non_taxable", amount: 100 }),
        tx("t2", { taxCategory: "exempt", amount: 200 }),
        tx("t3", { taxCategory: "out_of_scope", amount: 300 }),
        tx("t4", { status: "draft", taxCategory: "taxable", amount: 999 }),
        tx("t5", {
          type: "transfer",
          taxCategory: "taxable",
          amount: 999,
        }),
      ],
      [],
    );
    for (const bucket of ["non_taxable", "exempt", "out_of_scope"] as const) {
      const row = summary.rows.find((r) => r.bucket === bucket)!;
      expect(row.salesTax).toBe(0);
    }
    expect(summary.rows.find((r) => r.bucket === "taxable_standard")).toBeUndefined();
    expect(summary.filingAmounts).toEqual([]);
  });
});
