import { describe, expect, it } from "vitest";
import { DomainError, type DomainErrorCode } from "./errors";
import {
  assertTaxAmountConsistent,
  computeConsumptionTaxPayable,
  computeNetAmount,
  computeTaxAmount,
  isTaxableCategory,
  maxPossibleTaxAmount,
  sumTaxAmounts,
} from "./tax";

function expectDomainError(fn: () => unknown, code: DomainErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error("expected function to throw a DomainError");
}

describe("computeTaxAmount", () => {
  it("税抜金額に標準税率10%を掛けて切り捨てる", () => {
    expect(computeTaxAmount(10_000, { basis: "exclusive" })).toBe(1_000);
    expect(computeTaxAmount(1_005, { basis: "exclusive" })).toBe(100);
    expect(computeTaxAmount(999, { basis: "exclusive" })).toBe(99);
  });

  it("税抜金額に軽減税率8%を掛けて切り捨てる", () => {
    expect(
      computeTaxAmount(10_000, { basis: "exclusive", rate: "reduced" }),
    ).toBe(800);
    expect(
      computeTaxAmount(1_006, { basis: "exclusive", rate: "reduced" }),
    ).toBe(80);
    expect(
      computeTaxAmount(999, { basis: "exclusive", rate: "reduced" }),
    ).toBe(79);
  });

  it("税込金額から内税を切り捨てで取り出す", () => {
    expect(computeTaxAmount(11_000, { basis: "inclusive" })).toBe(1_000);
    expect(computeTaxAmount(1_100, { basis: "inclusive" })).toBe(100);
    expect(computeTaxAmount(1_110, { basis: "inclusive" })).toBe(100);
    expect(computeTaxAmount(1_099, { basis: "inclusive" })).toBe(99);
  });

  it("税込金額の内税(軽減税率8%)を切り捨てで取り出す", () => {
    expect(
      computeTaxAmount(1_080, { basis: "inclusive", rate: "reduced" }),
    ).toBe(80);
    expect(
      computeTaxAmount(1_079, { basis: "inclusive", rate: "reduced" }),
    ).toBe(79);
    expect(
      computeTaxAmount(107, { basis: "inclusive", rate: "reduced" }),
    ).toBe(7);
  });

  it("0円の消費税は0円", () => {
    expect(computeTaxAmount(0, { basis: "inclusive" })).toBe(0);
    expect(computeTaxAmount(0, { basis: "exclusive" })).toBe(0);
  });

  it("負額・小数を拒否する", () => {
    expectDomainError(
      () => computeTaxAmount(-1, { basis: "inclusive" }),
      "INVALID_AMOUNT",
    );
    expectDomainError(
      () => computeTaxAmount(1.5, { basis: "inclusive" }),
      "INVALID_AMOUNT",
    );
  });

  it("乗算が安全整数を超える場合はオーバーフローとして拒否する", () => {
    expectDomainError(
      () =>
        computeTaxAmount(Number.MAX_SAFE_INTEGER, {
          basis: "exclusive",
          rate: "reduced",
        }),
      "INVALID_AMOUNT",
    );
  });

  it("basis/rateの不正値を拒否する", () => {
    expectDomainError(
      () => computeTaxAmount(1_000, { basis: "weird" as never }),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () => computeTaxAmount(1_000, { basis: "inclusive", rate: "low" as never }),
      "VALIDATION_FAILED",
    );
  });
});

describe("computeNetAmount", () => {
  it("税込金額から本体価格を返す", () => {
    expect(computeNetAmount(11_000)).toBe(10_000);
    expect(computeNetAmount(1_099)).toBe(1_000);
    expect(computeNetAmount(1_080, "reduced")).toBe(1_000);
  });
});

describe("sumTaxAmounts", () => {
  it("明細ごとに切り捨ててから合算する", () => {
    // 999円(税抜10%)x2: 明細ごと99円 → 198円(合計1,998円に掛けると199円)
    expect(
      sumTaxAmounts([
        { amount: 999, basis: "exclusive" },
        { amount: 999, basis: "exclusive" },
      ]),
    ).toBe(198);
  });

  it("税率・税込/税抜が混在しても合算できる", () => {
    expect(
      sumTaxAmounts([
        { amount: 11_000, basis: "inclusive" },
        { amount: 1_080, basis: "inclusive", rate: "reduced" },
        { amount: 10_000, basis: "exclusive" },
      ]),
    ).toBe(1_000 + 80 + 1_000);
  });
});

describe("isTaxableCategory", () => {
  it("taxableのみ課税取引", () => {
    expect(isTaxableCategory("taxable")).toBe(true);
    expect(isTaxableCategory("nonTaxable")).toBe(false);
    expect(isTaxableCategory("exempt")).toBe(false);
    expect(isTaxableCategory("outOfScope")).toBe(false);
  });
});

describe("maxPossibleTaxAmount / assertTaxAmountConsistent", () => {
  it("上限は税抜10%相当(税込・税抜どちらの解釈でもあり得る最大)", () => {
    expect(maxPossibleTaxAmount(8_000)).toBe(800);
    expect(maxPossibleTaxAmount(11_000)).toBe(1_100);
    expect(maxPossibleTaxAmount(999)).toBe(99);
  });

  it("課税仕入は上限までの税額を許容する", () => {
    expect(() =>
      assertTaxAmountConsistent("taxable", 11_000, 1_000),
    ).not.toThrow();
    expect(() =>
      assertTaxAmountConsistent("taxable", 8_000, 800),
    ).not.toThrow();
    expect(() => assertTaxAmountConsistent("taxable", 1_000, 0)).not.toThrow();
  });

  it("課税仕入で上限超過を拒否する", () => {
    expectDomainError(
      () => assertTaxAmountConsistent("taxable", 1_000, 2_000),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () => assertTaxAmountConsistent("taxable", 1_000, 101),
      "VALIDATION_FAILED",
    );
  });

  it("非課税・免税・不課税は税額0のみ許容する", () => {
    for (const category of ["nonTaxable", "exempt", "outOfScope"] as const) {
      expect(() => assertTaxAmountConsistent(category, 11_000, 0)).not.toThrow();
      expectDomainError(
        () => assertTaxAmountConsistent(category, 11_000, 1),
        "VALIDATION_FAILED",
      );
    }
  });

  it("負の税額を拒否する", () => {
    expectDomainError(
      () => assertTaxAmountConsistent("taxable", 1_000, -1),
      "INVALID_AMOUNT",
    );
  });
});

describe("computeConsumptionTaxPayable", () => {
  it("免税事業者は納付額0", () => {
    expect(
      computeConsumptionTaxPayable("exempt", {
        outputTax: 1_000,
        inputTax: 500,
      }),
    ).toEqual({
      mode: "exempt",
      outputTax: 1_000,
      deductibleInputTax: 0,
      taxPayable: 0,
    });
  });

  it("本則課税は売上税額から仕入税額を控除する", () => {
    expect(
      computeConsumptionTaxPayable("standard", {
        outputTax: 1_000,
        inputTax: 300,
      }),
    ).toEqual({
      mode: "standard",
      outputTax: 1_000,
      deductibleInputTax: 300,
      taxPayable: 700,
    });
  });

  it("本則課税で控除超過は負数(還付相当)になる", () => {
    expect(
      computeConsumptionTaxPayable("standard", {
        outputTax: 300,
        inputTax: 1_000,
      }).taxPayable,
    ).toBe(-700);
  });

  it("簡易課税はみなし仕入率を適用する", () => {
    // 第5種(サービス業)=50%
    expect(
      computeConsumptionTaxPayable(
        "simple",
        { outputTax: 1_000_000 },
        { businessClass: 5 },
      ),
    ).toEqual({
      mode: "simple",
      outputTax: 1_000_000,
      deductibleInputTax: 500_000,
      taxPayable: 500_000,
    });
    // 第1種(卸売業)=90%
    expect(
      computeConsumptionTaxPayable(
        "simple",
        { outputTax: 1_000_000 },
        { businessClass: 1 },
      ).taxPayable,
    ).toBe(100_000);
  });

  it("みなし仕入れ額は切り捨てる", () => {
    // 第3種=70%: 999円×70% = 699.3 → 699
    const report = computeConsumptionTaxPayable(
      "simple",
      { outputTax: 999 },
      { businessClass: 3 },
    );
    expect(report.deductibleInputTax).toBe(699);
    expect(report.taxPayable).toBe(300);
  });

  it("簡易課税ではinputTaxを使わない", () => {
    const report = computeConsumptionTaxPayable(
      "simple",
      { outputTax: 1_000, inputTax: 999 },
      { businessClass: 6 },
    );
    expect(report.deductibleInputTax).toBe(400);
    expect(report.taxPayable).toBe(600);
  });

  it("簡易課税はbusinessClass必須、他方式では指定不可", () => {
    expectDomainError(
      () => computeConsumptionTaxPayable("simple", { outputTax: 1_000 }),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxPayable(
          "simple",
          { outputTax: 1_000 },
          { businessClass: 7 as never },
        ),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxPayable(
          "standard",
          { outputTax: 1_000 },
          { businessClass: 5 },
        ),
      "VALIDATION_FAILED",
    );
  });

  it("負の税額・不正なmodeを拒否する", () => {
    expectDomainError(
      () => computeConsumptionTaxPayable("standard", { outputTax: -1 }),
      "INVALID_AMOUNT",
    );
    expectDomainError(
      () => computeConsumptionTaxPayable("none" as never, { outputTax: 0 }),
      "VALIDATION_FAILED",
    );
  });
});
