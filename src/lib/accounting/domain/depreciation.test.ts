import { describe, expect, it } from "vitest";
import {
  fiscalYearEndDepreciation,
  monthsHeldInFiscalYear,
  type DepreciableAsset,
} from "./depreciation";
import { DomainError } from "./errors";

const base = {
  acquisitionCost: 300_000,
  usefulLifeYears: 5,
  method: "straightLine" as const,
  acquiredDate: "2026-01-15",
};

describe("monthsHeldInFiscalYear", () => {
  it("暦年の年中取得は取得月から12月までの月数", () => {
    expect(
      monthsHeldInFiscalYear({ acquiredDate: "2026-04-10" }, 2026, 1),
    ).toBe(9);
    expect(
      monthsHeldInFiscalYear({ acquiredDate: "2026-12-31" }, 2026, 1),
    ).toBe(1);
  });

  it("期首取得なら12、取得前年度は0", () => {
    expect(
      monthsHeldInFiscalYear({ acquiredDate: "2026-01-01" }, 2026, 1),
    ).toBe(12);
    expect(
      monthsHeldInFiscalYear({ acquiredDate: "2026-06-01" }, 2025, 1),
    ).toBe(0);
  });

  it("4月始まりの会計年度をまたぐ取得", () => {
    // 2026-06取得・FY2026(2026-04〜2027-03) → 6〜3月で10か月
    expect(
      monthsHeldInFiscalYear({ acquiredDate: "2026-06-15" }, 2026, 4),
    ).toBe(10);
  });

  it("除却した年は除却月までの月数", () => {
    expect(
      monthsHeldInFiscalYear(
        { acquiredDate: "2025-01-10", disposedDate: "2026-08-20" },
        2026,
        1,
      ),
    ).toBe(8);
    // 除却後の年度は0
    expect(
      monthsHeldInFiscalYear(
        { acquiredDate: "2025-01-10", disposedDate: "2026-08-20" },
        2027,
        1,
      ),
    ).toBe(0);
  });
});

describe("fiscalYearEndDepreciation (定額法)", () => {
  const asset: DepreciableAsset = { ...base };

  it("期首取得は年間60,000円ずつ償却", () => {
    const y1 = fiscalYearEndDepreciation(asset, 1, 2026);
    expect(y1).toMatchObject({
      months: 12,
      expense: 60_000,
      accumulated: 60_000,
      bookValue: 240_000,
    });
  });

  it("年度途中取得は保有月数で按分する", () => {
    const mid: DepreciableAsset = { ...base, acquiredDate: "2026-04-10" };
    // 300,000 × 9/60 = 45,000
    const y1 = fiscalYearEndDepreciation(mid, 1, 2026);
    expect(y1).toMatchObject({ months: 9, expense: 45_000 });
    // その後はフル年額。FY2027-2030 は60,000
    expect(fiscalYearEndDepreciation(mid, 1, 2027).expense).toBe(60_000);
    // FY2031: 45,000+60,000×4=285,000 → 残14,999のみ償却して帳簿価額1円
    const last = fiscalYearEndDepreciation(mid, 1, 2031);
    expect(last).toMatchObject({ expense: 14_999, bookValue: 1 });
  });

  it("最終年度は償却限度額(帳簿価額−1円)を超えない", () => {
    // 100,000/3年 → 33,333×3=99,999 → ちょうど3年で1円残
    const a: DepreciableAsset = {
      ...base,
      acquisitionCost: 100_000,
      usefulLifeYears: 3,
    };
    const y3 = fiscalYearEndDepreciation(a, 1, 2028);
    expect(y3).toMatchObject({
      expense: 33_333,
      accumulated: 99_999,
      bookValue: 1,
    });
    // 償却完了後の年度は expense=0・累計据え置き
    const y4 = fiscalYearEndDepreciation(a, 1, 2029);
    expect(y4).toMatchObject({ expense: 0, accumulated: 99_999, bookValue: 1 });
  });

  it("取得前の年度は償却なし・帳簿価額は取得価額", () => {
    const y0 = fiscalYearEndDepreciation(asset, 1, 2025);
    expect(y0).toMatchObject({
      months: 0,
      expense: 0,
      accumulated: 0,
      bookValue: 300_000,
    });
  });

  it("4月始まりの年度に対応する", () => {
    const a: DepreciableAsset = { ...base, acquiredDate: "2026-06-15" };
    // FY2026(2026-04〜2027-03): 10か月保有 → 300,000×10/60=50,000
    const y = fiscalYearEndDepreciation(a, 4, 2026);
    expect(y).toMatchObject({ months: 10, expense: 50_000 });
  });

  it("除却した年度は除却月まで償却し、以後は止まる", () => {
    const a: DepreciableAsset = { ...base, disposedDate: "2027-08-20" };
    const y = fiscalYearEndDepreciation(a, 1, 2027);
    expect(y).toMatchObject({ months: 8, expense: 40_000 });
    const next = fiscalYearEndDepreciation(a, 1, 2028);
    expect(next.expense).toBe(0);
    expect(next.accumulated).toBe(100_000);
  });
});

describe("fiscalYearEndDepreciation (定率法)", () => {
  const asset: DepreciableAsset = {
    acquisitionCost: 1_000_000,
    usefulLifeYears: 5,
    method: "decliningBalance",
    acquiredDate: "2026-01-01",
  };

  it("200%定率法で逓減し、残存均等額が上回る年から切り替わる", () => {
    // 償却率 2/5 = 0.4
    expect(fiscalYearEndDepreciation(asset, 1, 2026).expense).toBe(400_000);
    expect(fiscalYearEndDepreciation(asset, 1, 2027).expense).toBe(240_000);
    expect(fiscalYearEndDepreciation(asset, 1, 2028).expense).toBe(144_000);
    // Y4: 定率 86,400 < 残存均等 (216,000-1)×12/24=107,999 → 切替
    expect(fiscalYearEndDepreciation(asset, 1, 2029).expense).toBe(107_999);
    // Y5: 108,001×0.4=43,200 < 108,000 → 108,000 で帳簿価額1円
    const y5 = fiscalYearEndDepreciation(asset, 1, 2030);
    expect(y5).toMatchObject({ expense: 108_000, bookValue: 1 });
    expect(400_000 + 240_000 + 144_000 + 107_999 + 108_000).toBe(999_999);
  });

  it("耐用年数内に償却が完了する(漸近残しにならない)", () => {
    const a = accumulated5(asset);
    expect(a).toBe(999_999);
    const small: DepreciableAsset = {
      acquisitionCost: 50_000,
      usefulLifeYears: 8,
      method: "decliningBalance",
      acquiredDate: "2026-01-01",
    };
    const y8 = fiscalYearEndDepreciation(small, 1, 2033);
    expect(y8.bookValue).toBe(1);
  });

  it("年中取得の初年度は月数按分する", () => {
    const mid: DepreciableAsset = { ...asset, acquiredDate: "2026-07-01" };
    // 1,000,000 × 0.4 × 6/12 = 200,000
    const y1 = fiscalYearEndDepreciation(mid, 1, 2026);
    expect(y1).toMatchObject({ months: 6, expense: 200_000 });
    // Y2 期首帳簿価額 800,000 → 320,000
    expect(fiscalYearEndDepreciation(mid, 1, 2027).expense).toBe(320_000);
  });

  it("耐用年数2年は初年度にほぼ全額償却", () => {
    const a: DepreciableAsset = { ...asset, usefulLifeYears: 2 };
    // rate=1.0 → floor(1,000,000×1.0)=1,000,000 → 限度 999,999
    const y1 = fiscalYearEndDepreciation(a, 1, 2026);
    expect(y1).toMatchObject({ expense: 999_999, bookValue: 1 });
  });
});

function accumulated5(asset: DepreciableAsset): number {
  return fiscalYearEndDepreciation(asset, 1, 2030).accumulated;
}

describe("入力検証", () => {
  it("不正な入力を拒否する", () => {
    const bad: [Partial<DepreciableAsset>, string][] = [
      [{ acquisitionCost: 0 }, "INVALID_AMOUNT"],
      [{ acquisitionCost: -5 }, "INVALID_AMOUNT"],
      [{ acquisitionCost: 100.5 }, "INVALID_AMOUNT"],
      [{ usefulLifeYears: 0 }, "VALIDATION_FAILED"],
      [{ usefulLifeYears: 1.5 }, "VALIDATION_FAILED"],
      [{ method: "foo" as never }, "VALIDATION_FAILED"],
      [{ acquiredDate: "2026-13-01" }, "INVALID_DATE"],
      [{ disposedDate: "2025-12-31" }, "VALIDATION_FAILED"],
    ];
    for (const [patch, code] of bad) {
      try {
        fiscalYearEndDepreciation({ ...base, ...patch }, 1, 2026);
        expect.unreachable(`should throw for ${JSON.stringify(patch)}`);
      } catch (e) {
        expect(e).toBeInstanceOf(DomainError);
        expect((e as DomainError).code).toBe(code);
      }
    }
  });
});
