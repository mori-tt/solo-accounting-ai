import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { computeConsumptionTaxFiling } from "@/lib/accounting/domain/tax";
import { formatYen } from "@/lib/format";
import { ConsumptionTaxSheet } from "./consumption-tax-sheet";

afterEach(cleanup);

const RANGE = { startDate: "2026-01-01", endDate: "2026-12-31" };
const AMOUNTS = [
  { rate: "standard", salesYen: 11_000_000, purchasesYen: 5_500_000 },
] as const;

describe("ConsumptionTaxSheet", () => {
  it("本則課税: 課税標準額→消費税額→控除→納付税額を出力する", () => {
    const filing = computeConsumptionTaxFiling("standard", [...AMOUNTS]);
    render(
      <ConsumptionTaxSheet
        businessName="山田商店"
        range={RANGE}
        mode="standard"
        amounts={[...AMOUNTS]}
        filing={filing}
      />,
    );

    expect(screen.getByText("山田商店")).toBeTruthy();
    // 課税標準額 10,000,000 / 消費税額 780,000 / 控除 390,000
    expect(
      screen.getAllByText(formatYen(10_000_000)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(formatYen(780_000)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(formatYen(390_000)).length,
    ).toBeGreaterThan(0);
    // 納付: 国税 390,000 / 地方消費税 110,000 / 合計 500,000
    expect(
      screen.getAllByText(formatYen(110_000)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(formatYen(500_000))).toBeTruthy();
    expect(
      screen.getByText("納付税額の合計(国税+地方消費税)"),
    ).toBeTruthy();
  });

  it("簡易課税: みなし仕入率の控除行を出力する", () => {
    const filing = computeConsumptionTaxFiling("simple", [...AMOUNTS], {
      businessClass: 5,
    });
    render(
      <ConsumptionTaxSheet
        businessName="山田商店"
        range={RANGE}
        mode="simple"
        businessClass={5}
        amounts={[...AMOUNTS]}
        filing={filing}
      />,
    );

    expect(
      screen.getByText(/みなし仕入率による控除額.*50%・第5種/),
    ).toBeTruthy();
    expect(
      screen.getByText(/簡易課税\(第5種・みなし仕入率50%\)/),
    ).toBeTruthy();
    // 控除 780,000×50% = 390,000 → 差引 390,000 → 納付合計 500,000
    expect(screen.getByText(formatYen(500_000))).toBeTruthy();
  });

  it("2割特例: 80%控除行と納付税額を出力する", () => {
    const filing = computeConsumptionTaxFiling("special20", [...AMOUNTS], {
      period: RANGE,
    });
    render(
      <ConsumptionTaxSheet
        businessName="山田商店"
        range={RANGE}
        mode="special20"
        amounts={[...AMOUNTS]}
        filing={filing}
      />,
    );

    expect(
      screen.getByText(/課税方式:.*2割特例\(インボイス制度移行措置\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/控除対象仕入税額\(2割特例・消費税額×80%\)/),
    ).toBeTruthy();
    // 消費税額 780,000 → 控除 624,000 → 差引 156,000
    expect(screen.getByText(formatYen(624_000))).toBeTruthy();
    // 156,000 は差引税額・納付税額(国税)の2行に出る
    expect(
      screen.getAllByText(formatYen(156_000)).length,
    ).toBeGreaterThan(1);
    // 納付: 国税 156,000 / 地方消費税 44,000 / 合計 200,000
    expect(screen.getByText(formatYen(44_000))).toBeTruthy();
    expect(screen.getByText(formatYen(200_000))).toBeTruthy();
    // 本則課税・簡易課税向けの行は出さない
    expect(screen.queryByText(/みなし仕入率による控除額/)).toBeNull();
    expect(screen.queryByText(/課税仕入れ等に係る支払対価/)).toBeNull();
  });

  it("控除超過時は還付税額の行を出力する", () => {
    const amounts = [
      { rate: "standard", salesYen: 1_111_111, purchasesYen: 2_222_222 },
      { rate: "reduced", salesYen: 555_555 },
    ] as const;
    const filing = computeConsumptionTaxFiling("standard", [...amounts]);
    render(
      <ConsumptionTaxSheet
        businessName="山田商店"
        range={RANGE}
        mode="standard"
        amounts={[...amounts]}
        filing={filing}
      />,
    );

    expect(screen.getByText("還付税額(消費税・国税)")).toBeTruthy();
    expect(screen.getByText("譲渡割額(地方消費税の還付分)")).toBeTruthy();
    // 還付 46,722 / 譲渡割 13,178 / 合計 59,900
    expect(screen.getByText(formatYen(46_722))).toBeTruthy();
    expect(screen.getByText(formatYen(13_178))).toBeTruthy();
    expect(screen.getByText(formatYen(59_900))).toBeTruthy();
    expect(
      screen.queryByText("納付税額の合計(国税+地方消費税)"),
    ).toBeNull();
  });
});
