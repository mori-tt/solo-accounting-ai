import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  invoiceItemTaxAmount,
  invoiceTaxAmount,
  isInvoiceTaxRate,
} from "./invoice-tax";

describe("invoiceItemTaxAmount", () => {
  it("税込金額から標準税率10%の内税を切り捨てで取り出す", () => {
    expect(invoiceItemTaxAmount({ amount: 11_000, taxRate: "standard" })).toBe(
      1_000,
    );
    expect(invoiceItemTaxAmount({ amount: 1_099, taxRate: "standard" })).toBe(
      99,
    );
  });

  it("税込金額から軽減税率8%の内税を切り捨てで取り出す", () => {
    expect(invoiceItemTaxAmount({ amount: 1_080, taxRate: "reduced" })).toBe(80);
    expect(invoiceItemTaxAmount({ amount: 107, taxRate: "reduced" })).toBe(7);
  });

  it("taxRate 省略時は標準税率として扱う", () => {
    expect(invoiceItemTaxAmount({ amount: 11_000 })).toBe(1_000);
  });
});

describe("computeInvoiceTotals", () => {
  it("明細ごとの税額を切り捨ててから合算する", () => {
    // 200,000円(10%) → 18,181 / 30,000円(8%) → 2,222
    const totals = computeInvoiceTotals([
      { amount: 200_000, taxRate: "standard" },
      { amount: 30_000, taxRate: "reduced" },
    ]);
    expect(totals.totalAmount).toBe(230_000);
    expect(totals.taxAmount).toBe(18_181 + 2_222);
  });

  it("明細単位の切り捨てが合算後の切り捨てと異なり得る", () => {
    // 単一明細 230,000円(10%) → floor(230,000/11) = 20,909
    // 2明細(200,000+30,000・いずれも10%) → 18,181+2,727 = 20,908
    const single = computeInvoiceTotals([{ amount: 230_000 }]);
    const split = computeInvoiceTotals([
      { amount: 200_000 },
      { amount: 30_000 },
    ]);
    expect(single.taxAmount).toBe(20_909);
    expect(split.taxAmount).toBe(20_908);
  });

  it("空明細・0円明細は0円", () => {
    expect(computeInvoiceTotals([])).toEqual({
      totalAmount: 0,
      taxAmount: 0,
    });
    expect(computeInvoiceTotals([{ amount: 0 }])).toEqual({
      totalAmount: 0,
      taxAmount: 0,
    });
  });
});

describe("invoiceTaxAmount", () => {
  it("保存済み taxAmount があればそれを返す", () => {
    expect(
      invoiceTaxAmount({
        items: [{ description: "x", quantity: 1, unitPrice: 11_000, amount: 11_000 }],
        taxAmount: 1_000,
      }),
    ).toBe(1_000);
  });

  it("税フィールド未保存の旧データは明細から導出する(標準税率扱い)", () => {
    // 税フィールド導入前の形式: taxRate/taxAmount なし
    expect(
      invoiceTaxAmount({
        items: [
          { description: "x", quantity: 2, unitPrice: 100_000, amount: 200_000 },
          { description: "y", quantity: 1, unitPrice: 30_000, amount: 30_000 },
        ],
      }),
    ).toBe(20_908);
  });
});

describe("isInvoiceTaxRate", () => {
  it("standard/reduced のみ許容する", () => {
    expect(isInvoiceTaxRate("standard")).toBe(true);
    expect(isInvoiceTaxRate("reduced")).toBe(true);
    expect(isInvoiceTaxRate("exempt")).toBe(false);
    expect(isInvoiceTaxRate(10)).toBe(false);
    expect(isInvoiceTaxRate(undefined)).toBe(false);
  });
});
