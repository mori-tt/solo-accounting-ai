import { describe, expect, it } from "vitest";
import {
  BLUE_RETURN_DEDUCTION_MAX,
  buildIncomeStatement,
  computeNetIncome,
} from "./filing";
import { buildYearlyReport, type YearlyTransaction } from "./yearly";

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

function reportOf(transactions: YearlyTransaction[]) {
  return buildYearlyReport(transactions, 2026, 1);
}

describe("buildIncomeStatement", () => {
  it("収入・売上原価(仕入)・経費を様式の部に振り分ける", () => {
    const s = buildIncomeStatement(
      reportOf([
        tx("t1", { account: "sales", amount: 500000 }),
        tx("t2", { account: "misc_income", amount: 20000 }),
        tx("t3", {
          type: "expense",
          account: "purchases",
          amount: 100000,
        }),
        tx("t4", {
          type: "expense",
          account: "rent",
          amount: 120000,
        }),
        tx("t5", {
          type: "expense",
          account: "supplies",
          amount: 30000,
        }),
      ]),
    );
    expect(s.incomeRows).toEqual([
      { account: "misc_income", amount: 20000 },
      { account: "sales", amount: 500000 },
    ]);
    expect(s.totalIncome).toBe(520000);
    expect(s.purchaseRows).toEqual([
      { account: "purchases", amount: 100000 },
    ]);
    expect(s.totalPurchases).toBe(100000);
    expect(s.expenseRows).toEqual([
      { account: "rent", amount: 120000 },
      { account: "supplies", amount: 30000 },
    ]);
    expect(s.totalExpenses).toBe(150000);
    expect(s.grossIncome).toBe(520000 - 100000 - 150000);
  });

  it("取引が無い年度は各部0の空帳票を返す", () => {
    const s = buildIncomeStatement(reportOf([]));
    expect(s.incomeRows).toEqual([]);
    expect(s.purchaseRows).toEqual([]);
    expect(s.expenseRows).toEqual([]);
    expect(s.totalIncome).toBe(0);
    expect(s.grossIncome).toBe(0);
    expect(s.familyEmployeeSalary).toBe(0);
  });

  it("family_salary科目は経費から分離して専従者給与の初期値にする", () => {
    const s = buildIncomeStatement(
      reportOf([
        tx("t1", { account: "sales", amount: 1_000_000 }),
        tx("t2", {
          type: "expense",
          account: "family_salary",
          amount: 300_000,
        }),
        tx("t3", {
          type: "expense",
          account: "family_salary",
          amount: 100_000,
        }),
        tx("t4", {
          type: "expense",
          account: "rent",
          amount: 120_000,
        }),
      ]),
    );
    // 経費部には載せず(二重計上防止)、専従者給与欄の初期値に集計する
    expect(s.expenseRows).toEqual([
      { account: "rent", amount: 120_000 },
    ]);
    expect(s.totalExpenses).toBe(120_000);
    expect(s.familyEmployeeSalary).toBe(400_000);
    // 差引金額には専従者給与を含めない(所得計算時に専用欄で差し引く)
    expect(s.grossIncome).toBe(1_000_000 - 120_000);
  });

  it("赤字(経費が収入を超過)は差引金額が負になる", () => {
    const s = buildIncomeStatement(
      reportOf([
        tx("t1", { amount: 100 }),
        tx("t2", { type: "expense", account: "rent", amount: 500 }),
      ]),
    );
    expect(s.grossIncome).toBe(-400);
  });
});

describe("computeNetIncome", () => {
  it("差引金額から専従者給与と控除を差し引く", () => {
    const r = computeNetIncome({
      grossIncome: 3_000_000,
      familyEmployeeSalary: 500_000,
      blueReturnDeduction: 650_000,
    });
    expect(r.incomeAfterFamilySalary).toBe(2_500_000);
    expect(r.appliedDeduction).toBe(650_000);
    expect(r.netIncome).toBe(1_850_000);
  });

  it("控除は差引後所得を上限として適用する", () => {
    const r = computeNetIncome({
      grossIncome: 400_000,
      familyEmployeeSalary: 0,
      blueReturnDeduction: 650_000,
    });
    expect(r.appliedDeduction).toBe(400_000);
    expect(r.netIncome).toBe(0);
  });

  it("専従者給与で赤字になっても所得金額は0未満にしない", () => {
    const r = computeNetIncome({
      grossIncome: 100_000,
      familyEmployeeSalary: 300_000,
      blueReturnDeduction: 650_000,
    });
    expect(r.incomeAfterFamilySalary).toBe(-200_000);
    expect(r.appliedDeduction).toBe(0);
    expect(r.netIncome).toBe(0);
  });

  it("控除は65万円を上限に検証する", () => {
    expect(() =>
      computeNetIncome({
        grossIncome: 1_000_000,
        blueReturnDeduction: BLUE_RETURN_DEDUCTION_MAX + 1,
      }),
    ).toThrow();
    expect(() =>
      computeNetIncome({ grossIncome: 1_000_000, blueReturnDeduction: -1 }),
    ).toThrow();
  });

  it("負の専従者給与・非整数はエラーになる", () => {
    expect(() =>
      computeNetIncome({ grossIncome: 100, familyEmployeeSalary: -1 }),
    ).toThrow();
    expect(() => computeNetIncome({ grossIncome: 1.5 })).toThrow();
  });

  it("入力省略時は専従者給与0・控除0として計算する", () => {
    const r = computeNetIncome({ grossIncome: 250_000 });
    expect(r.appliedDeduction).toBe(0);
    expect(r.netIncome).toBe(250_000);
  });
});
