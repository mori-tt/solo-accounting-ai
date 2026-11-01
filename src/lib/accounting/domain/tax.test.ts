import { describe, expect, it } from "vitest";
import { DomainError, type DomainErrorCode } from "./errors";
import {
  assertTaxAmountConsistent,
  computeConsumptionTaxFiling,
  computeConsumptionTaxPayable,
  computeNetAmount,
  computeTaxableBase,
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

describe("computeTaxableBase", () => {
  it("税込対価×100/110を千円未満切捨てする(標準税率)", () => {
    expect(computeTaxableBase(11_000)).toBe(10_000);
    expect(computeTaxableBase(1_105_500)).toBe(1_005_000);
    // 1,234,567 × 10/11 = 1,122,333 → 1,122,000
    expect(computeTaxableBase(1_234_567)).toBe(1_122_000);
  });

  it("税込対価×100/108を千円未満切捨てする(軽減税率)", () => {
    expect(computeTaxableBase(1_080, "reduced")).toBe(1_000);
    // 1,234,567 × 25/27 = 1,143,117 → 1,143,000
    expect(computeTaxableBase(1_234_567, "reduced")).toBe(1_143_000);
  });

  it("税抜換算が千円未満なら課税標準額は0", () => {
    expect(computeTaxableBase(1_099)).toBe(0);
    expect(computeTaxableBase(1_099, "reduced")).toBe(1_000);
    expect(computeTaxableBase(0)).toBe(0);
  });

  it("負額・小数・不正なrateを拒否する", () => {
    expectDomainError(() => computeTaxableBase(-1), "INVALID_AMOUNT");
    expectDomainError(() => computeTaxableBase(1.5), "INVALID_AMOUNT");
    expectDomainError(
      () => computeTaxableBase(1_000, "old" as never),
      "VALIDATION_FAILED",
    );
  });
});

describe("computeConsumptionTaxFiling", () => {
  it("本則課税・単一税率: 課税標準額→国税7.8%→仕入控除→地方税22/78", () => {
    // 売上1,100万円(税込)→標準額1,000万→消費税78万
    // 仕入550万円(税込)→仕入税額39万、差引39万
    const filing = computeConsumptionTaxFiling("standard", [
      { rate: "standard", salesYen: 11_000_000, purchasesYen: 5_500_000 },
    ]);
    expect(filing).toEqual({
      mode: "standard",
      breakdown: [
        {
          rate: "standard",
          taxableBase: 10_000_000,
          nationalTax: 780_000,
          deductibleInputTax: 390_000,
        },
      ],
      totalTaxableBase: 10_000_000,
      nationalTax: 780_000,
      deductibleInputTax: 390_000,
      balance: 390_000,
      nationalTaxPayable: 390_000,
      localTaxPayable: 110_000,
      totalPayable: 500_000,
      nationalTaxRefundable: 0,
      localTaxRefundable: 0,
    });
  });

  it("軽減税率と標準税率を区分して内訳を出す", () => {
    const filing = computeConsumptionTaxFiling("standard", [
      { rate: "reduced", salesYen: 555_555 },
      { rate: "standard", salesYen: 1_111_111, purchasesYen: 2_222_222 },
    ]);
    expect(filing.breakdown).toEqual([
      {
        rate: "standard",
        taxableBase: 1_010_000,
        nationalTax: 78_780,
        deductibleInputTax: 157_575,
      },
      {
        rate: "reduced",
        taxableBase: 514_000,
        nationalTax: 32_073,
        deductibleInputTax: 0,
      },
    ]);
    expect(filing.totalTaxableBase).toBe(1_524_000);
    expect(filing.nationalTax).toBe(110_853);
    expect(filing.deductibleInputTax).toBe(157_575);
  });

  it("同一税率の項目は合算してから課税標準額を出す", () => {
    const filing = computeConsumptionTaxFiling("standard", [
      { rate: "standard", salesYen: 600_000 },
      { rate: "standard", salesYen: 511_111 },
    ]);
    // 合算1,111,111 → net 1,010,100 → base 1,010,000(個別だと別の千円台になる)
    expect(filing.breakdown[0].taxableBase).toBe(1_010_000);
  });

  it("控除超過は還付(国税・地方税とも1円精度、百円切捨てなし)", () => {
    const filing = computeConsumptionTaxFiling("standard", [
      { rate: "standard", salesYen: 1_111_111, purchasesYen: 2_222_222 },
      { rate: "reduced", salesYen: 555_555 },
    ]);
    // 消費税110,853 - 仕入157,575 = -46,722
    expect(filing.balance).toBe(-46_722);
    expect(filing.nationalTaxPayable).toBe(0);
    expect(filing.localTaxPayable).toBe(0);
    expect(filing.totalPayable).toBe(0);
    expect(filing.nationalTaxRefundable).toBe(46_722);
    // 46,722 × 22/78 = 13,178(割り切れる)
    expect(filing.localTaxRefundable).toBe(13_178);
  });

  it("納付額は百円未満切捨て、地方消費税は切捨て前の差引税額が課税標準", () => {
    // 売上1,105,500(税込)→標準額1,005,000→消費税78,390→差引78,390
    const filing = computeConsumptionTaxFiling("standard", [
      { rate: "standard", salesYen: 1_105_500 },
    ]);
    expect(filing.balance).toBe(78_390);
    // 国税は百円未満切捨て
    expect(filing.nationalTaxPayable).toBe(78_300);
    // 地方消費税: 78,390(切捨て前)×22/78=22,110→百円切捨て22,100
    // 切捨て後の78,300を課税標準にすると22,084→22,000になり誤り
    expect(filing.localTaxPayable).toBe(22_100);
    expect(filing.totalPayable).toBe(100_400);
  });

  it("簡易課税はみなし仕入率を消費税額合計に適用する", () => {
    // 第5種=50%: 消費税156万→控除78万→差引78万
    const filing = computeConsumptionTaxFiling(
      "simple",
      [
        { rate: "standard", salesYen: 22_000_000 },
        { rate: "reduced", salesYen: 1_080_000, purchasesYen: 9_999_999 },
      ],
      { businessClass: 5 },
    );
    expect(filing.nationalTax).toBe(1_560_000 + 62_400);
    expect(filing.deductibleInputTax).toBe(811_200);
    // 簡易課税は税率別の仕入税額を算出しない(purchasesYenは使わない)
    expect(
      filing.breakdown.every((row) => row.deductibleInputTax === 0),
    ).toBe(true);
    expect(filing.balance).toBe(811_200);
    expect(filing.nationalTaxPayable).toBe(811_200);
    // 811,200 × 22/78 = 228,800
    expect(filing.localTaxPayable).toBe(228_800);
    expect(filing.totalPayable).toBe(1_040_000);
  });

  it("免税事業者は全額0・内訳なし", () => {
    const filing = computeConsumptionTaxFiling("exempt", [
      { rate: "standard", salesYen: 11_000_000, purchasesYen: 5_500_000 },
    ]);
    expect(filing).toEqual({
      mode: "exempt",
      breakdown: [],
      totalTaxableBase: 0,
      nationalTax: 0,
      deductibleInputTax: 0,
      balance: 0,
      nationalTaxPayable: 0,
      localTaxPayable: 0,
      totalPayable: 0,
      nationalTaxRefundable: 0,
      localTaxRefundable: 0,
    });
  });

  it("差引0なら納付・還付とも0", () => {
    const filing = computeConsumptionTaxFiling("standard", [
      { rate: "standard", salesYen: 1_100_000, purchasesYen: 1_100_000 },
    ]);
    expect(filing.balance).toBe(0);
    expect(filing.totalPayable).toBe(0);
    expect(filing.nationalTaxRefundable).toBe(0);
    expect(filing.localTaxRefundable).toBe(0);
  });

  it("空の入力は全額0", () => {
    const filing = computeConsumptionTaxFiling("standard", []);
    expect(filing.breakdown).toEqual([]);
    expect(filing.totalPayable).toBe(0);
  });

  it("簡易課税はbusinessClass必須、他方式では指定不可", () => {
    expectDomainError(
      () =>
        computeConsumptionTaxFiling("simple", [
          { rate: "standard", salesYen: 1_100_000 },
        ]),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxFiling(
          "simple",
          [{ rate: "standard", salesYen: 1_100_000 }],
          { businessClass: 7 as never },
        ),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxFiling(
          "standard",
          [{ rate: "standard", salesYen: 1_100_000 }],
          { businessClass: 5 },
        ),
      "VALIDATION_FAILED",
    );
  });

  it("負額・小数・不正なrate/modeを拒否する", () => {
    expectDomainError(
      () =>
        computeConsumptionTaxFiling("standard", [
          { rate: "standard", salesYen: -1 },
        ]),
      "INVALID_AMOUNT",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxFiling("standard", [
          { rate: "standard", salesYen: 1_000, purchasesYen: 0.5 },
        ]),
      "INVALID_AMOUNT",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxFiling("standard", [
          { rate: "old" as never, salesYen: 1_000 },
        ]),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () => computeConsumptionTaxFiling("none" as never, []),
      "VALIDATION_FAILED",
    );
  });
});
