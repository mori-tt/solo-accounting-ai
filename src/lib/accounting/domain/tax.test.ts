import { describe, expect, it } from "vitest";
import { DomainError, type DomainErrorCode } from "./errors";
import {
  assertTaxAmountConsistent,
  computeConsumptionTaxFiling,
  computeConsumptionTaxPayable,
  computeNetAmount,
  computeTaxableBase,
  computeTaxAmount,
  isSpecial20ApplicablePeriod,
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
    expect(isTaxableCategory("non_taxable")).toBe(false);
    expect(isTaxableCategory("exempt")).toBe(false);
    expect(isTaxableCategory("out_of_scope")).toBe(false);
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
    for (const category of ["non_taxable", "exempt", "out_of_scope"] as const) {
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

  it("2割特例は消費税額の80%を控除する(納付=約20%)", () => {
    const period = { startDate: "2024-01-01", endDate: "2024-12-31" };
    expect(
      computeConsumptionTaxPayable(
        "special20",
        { outputTax: 1_000_000, inputTax: 999 },
        { period },
      ),
    ).toEqual({
      mode: "special20",
      outputTax: 1_000_000,
      deductibleInputTax: 800_000,
      taxPayable: 200_000,
    });
    // 切捨て: 999×80% = 799.2 → 799、差引 200
    const report = computeConsumptionTaxPayable(
      "special20",
      { outputTax: 999 },
      { period },
    );
    expect(report.deductibleInputTax).toBe(799);
    expect(report.taxPayable).toBe(200);
  });

  it("2割特例はperiod必須、適用期間外は拒否する", () => {
    expectDomainError(
      () => computeConsumptionTaxPayable("special20", { outputTax: 1_000 }),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxPayable(
          "special20",
          { outputTax: 1_000 },
          {
            period: { startDate: "2027-01-01", endDate: "2027-12-31" },
          },
        ),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxPayable(
          "special20",
          { outputTax: 1_000 },
          {
            period: { startDate: "2024-01-01", endDate: "2024-12-31" },
            businessClass: 5,
          },
        ),
      "VALIDATION_FAILED",
    );
  });

  it("2割特例以外の方式ではperiodを指定できない", () => {
    const period = { startDate: "2024-01-01", endDate: "2024-12-31" };
    expectDomainError(
      () =>
        computeConsumptionTaxPayable(
          "standard",
          { outputTax: 1_000 },
          { period },
        ),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxPayable(
          "exempt",
          { outputTax: 1_000 },
          { period },
        ),
      "VALIDATION_FAILED",
    );
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

  it("2割特例は消費税額合計の80%を控除する(納付=約20%)", () => {
    // 売上1,100万円(税込)→標準額1,000万→消費税78万
    // 控除 780,000×80% = 624,000 → 差引 156,000
    const filing = computeConsumptionTaxFiling(
      "special20",
      [{ rate: "standard", salesYen: 11_000_000, purchasesYen: 9_999_999 }],
      { period: { startDate: "2024-01-01", endDate: "2024-12-31" } },
    );
    expect(filing).toEqual({
      mode: "special20",
      breakdown: [
        {
          rate: "standard",
          taxableBase: 10_000_000,
          nationalTax: 780_000,
          // みなし仕入れは消費税額合計への適用のため税率別按分しない
          deductibleInputTax: 0,
        },
      ],
      totalTaxableBase: 10_000_000,
      nationalTax: 780_000,
      deductibleInputTax: 624_000,
      balance: 156_000,
      nationalTaxPayable: 156_000,
      // 156,000 × 22/78 = 44,000
      localTaxPayable: 44_000,
      totalPayable: 200_000,
      nationalTaxRefundable: 0,
      localTaxRefundable: 0,
    });
  });

  it("2割特例は軽減税率込みでも消費税額合計に80%を適用し還付しない", () => {
    // 10%: 標準額 10,000,000 → 780,000 / 軽減8%: 標準額 1,000,000 → 62,400
    // 合計 842,400 → 控除 floor(842,400×0.8) = 673,920 → 差引 168,480
    const filing = computeConsumptionTaxFiling(
      "special20",
      [
        { rate: "standard", salesYen: 11_000_000, purchasesYen: 9_999_999 },
        { rate: "reduced", salesYen: 1_080_000 },
      ],
      { period: { startDate: "2026-04-01", endDate: "2027-03-31" } },
    );
    expect(filing.nationalTax).toBe(842_400);
    expect(filing.deductibleInputTax).toBe(673_920);
    expect(filing.balance).toBe(168_480);
    expect(filing.nationalTaxPayable).toBe(168_400);
    // 168,480 × 22/78 = 47,520 → 百円未満切捨て 47,500
    expect(filing.localTaxPayable).toBe(47_500);
    expect(filing.totalPayable).toBe(215_900);
    expect(filing.nationalTaxRefundable).toBe(0);
    expect(filing.localTaxRefundable).toBe(0);
  });

  it("2割特例はperiod必須、適用期間外は拒否する", () => {
    const amounts = [{ rate: "standard", salesYen: 1_100_000 }] as const;
    expectDomainError(
      () => computeConsumptionTaxFiling("special20", [...amounts]),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxFiling("special20", [...amounts], {
          period: { startDate: "2027-01-01", endDate: "2027-12-31" },
        }),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxFiling("special20", [...amounts], {
          period: { startDate: "2023-01-01", endDate: "2023-09-30" },
        }),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxFiling("special20", [...amounts], {
          period: { startDate: "2024-01-01", endDate: "2024-12-31" },
          businessClass: 5,
        }),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        computeConsumptionTaxFiling("standard", [...amounts], {
          period: { startDate: "2024-01-01", endDate: "2024-12-31" },
        }),
      "VALIDATION_FAILED",
    );
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

describe("isSpecial20ApplicablePeriod", () => {
  it("適用対象期間(2023-10-01〜2026-09-30)の日を含む課税期間は適用可", () => {
    // 暦年課税期間の境界
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2023-01-01",
        endDate: "2023-12-31",
      }),
    ).toBe(true);
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      }),
    ).toBe(true);
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      }),
    ).toBe(true);
    // 4月始まりの課税期間
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2023-04-01",
        endDate: "2024-03-31",
      }),
    ).toBe(true);
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2026-04-01",
        endDate: "2027-03-31",
      }),
    ).toBe(true);
    // 適用対象期間と完全一致・その内側・1日だけの重なりも可
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2023-10-01",
        endDate: "2026-09-30",
      }),
    ).toBe(true);
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2023-10-01",
        endDate: "2023-12-31",
      }),
    ).toBe(true);
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2026-09-30",
        endDate: "2026-12-31",
      }),
    ).toBe(true);
  });

  it("適用対象期間と重ならない課税期間は適用不可", () => {
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2022-01-01",
        endDate: "2022-12-31",
      }),
    ).toBe(false);
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2023-01-01",
        endDate: "2023-09-30",
      }),
    ).toBe(false);
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2027-01-01",
        endDate: "2027-12-31",
      }),
    ).toBe(false);
    expect(
      isSpecial20ApplicablePeriod({
        startDate: "2026-10-01",
        endDate: "2027-09-30",
      }),
    ).toBe(false);
  });

  it("不正な期間・日付を拒否する", () => {
    expectDomainError(
      () =>
        isSpecial20ApplicablePeriod({
          startDate: "2024-12-31",
          endDate: "2024-01-01",
        }),
      "VALIDATION_FAILED",
    );
    expectDomainError(
      () =>
        isSpecial20ApplicablePeriod({
          startDate: "2024/01/01",
          endDate: "2024-12-31",
        }),
      "INVALID_DATE",
    );
    expectDomainError(
      () =>
        isSpecial20ApplicablePeriod({
          startDate: "2024-02-30",
          endDate: "2024-12-31",
        }),
      "INVALID_DATE",
    );
  });
});
