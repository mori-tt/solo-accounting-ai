import { describe, expect, it } from "vitest";
import {
  FILING_ALERT_AHEAD_DAYS,
  filingDeadlineAlerts,
  type FilingDeadlineContext,
} from "./deadlines";

const base: FilingDeadlineContext = {
  asOf: "2026-01-01",
  taxMode: "standard",
  hasDepreciableAssets: false,
};

// 2026年の曜日: 1/31(土)→2/2(月)調整、3/15(日)→3/16(月)調整、3/31(火)調整なし

describe("filingDeadlineAlerts", () => {
  it("期限30日前から upcoming で表示する", () => {
    const alerts = filingDeadlineAlerts({ ...base, asOf: "2026-02-14" });
    expect(alerts).toEqual([
      {
        kind: "income_tax",
        label: "確定申告(所得税)",
        dueDate: "2026-03-16",
        daysUntil: FILING_ALERT_AHEAD_DAYS,
        state: "upcoming",
      },
    ]);
  });

  it("期限31日前はまだ表示しない", () => {
    expect(
      filingDeadlineAlerts({ ...base, asOf: "2026-02-13" }),
    ).toEqual([]);
  });

  it("期限当日は daysUntil=0 で upcoming のまま表示する", () => {
    const alerts = filingDeadlineAlerts({ ...base, asOf: "2026-03-16" });
    expect(alerts[0]).toMatchObject({
      kind: "income_tax",
      daysUntil: 0,
      state: "upcoming",
    });
    expect(alerts[1]).toMatchObject({
      kind: "consumption_tax",
      daysUntil: 15,
      state: "upcoming",
    });
  });

  it("期限超過は猶予内なら overdue で表示する", () => {
    const alerts = filingDeadlineAlerts({ ...base, asOf: "2026-03-20" });
    expect(alerts[0]).toMatchObject({
      kind: "income_tax",
      daysUntil: -4,
      state: "overdue",
    });
    expect(alerts[1]).toMatchObject({
      kind: "consumption_tax",
      daysUntil: 11,
      state: "upcoming",
    });
  });

  it("期限超過の猶予を過ぎると表示しない", () => {
    // 確定申告 3/16 から 31日超過 → 対象外、消費税 3/31 から 20日超過 → 対象
    const alerts = filingDeadlineAlerts({ ...base, asOf: "2026-04-20" });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "consumption_tax",
      dueDate: "2026-03-31",
      daysUntil: -20,
      state: "overdue",
    });
    expect(
      filingDeadlineAlerts({ ...base, asOf: "2026-05-01" }),
    ).toEqual([]);
  });

  it("複数アラートは期限日昇順で返る", () => {
    const alerts = filingDeadlineAlerts({ ...base, asOf: "2026-03-01" });
    expect(alerts.map((a) => a.kind)).toEqual([
      "income_tax",
      "consumption_tax",
    ]);
    expect(alerts[0].daysUntil).toBe(15);
    expect(alerts[1].daysUntil).toBe(30);
  });

  it("免税事業者には消費税申告を出さない", () => {
    const alerts = filingDeadlineAlerts({
      ...base,
      asOf: "2026-03-20",
      taxMode: "exempt",
    });
    expect(alerts.map((a) => a.kind)).toEqual(["income_tax"]);
  });

  it("簡易課税事業者にも消費税申告を出す", () => {
    const alerts = filingDeadlineAlerts({
      ...base,
      asOf: "2026-03-20",
      taxMode: "simple",
    });
    expect(alerts.map((a) => a.kind)).toContain("consumption_tax");
  });

  it("償却資産がある場合のみ償却資産申告を出す(1/31は土曜→2/2に調整)", () => {
    const withAssets = filingDeadlineAlerts({
      ...base,
      asOf: "2026-01-10",
      hasDepreciableAssets: true,
    });
    expect(withAssets).toEqual([
      {
        kind: "depreciable_assets",
        label: "償却資産の申告",
        dueDate: "2026-02-02",
        daysUntil: 23,
        state: "upcoming",
      },
    ]);
    expect(
      filingDeadlineAlerts({ ...base, asOf: "2026-01-10" }),
    ).toEqual([]);
  });

  it("償却資産申告の期限超過も overdue で出る", () => {
    const alerts = filingDeadlineAlerts({
      ...base,
      asOf: "2026-02-20",
      hasDepreciableAssets: true,
    });
    expect(alerts[0]).toMatchObject({
      kind: "depreciable_assets",
      dueDate: "2026-02-02",
      daysUntil: -18,
      state: "overdue",
    });
  });

  it("年またぎ: 年末には翌年の期限を対象にする", () => {
    // 2027年の償却資産期限は 1/31(日) → 2/1(月)調整。2027-01-02時点で30日前
    const alerts = filingDeadlineAlerts({
      ...base,
      asOf: "2027-01-02",
      hasDepreciableAssets: true,
    });
    expect(alerts).toEqual([
      {
        kind: "depreciable_assets",
        label: "償却資産の申告",
        dueDate: "2027-02-01",
        daysUntil: 30,
        state: "upcoming",
      },
    ]);
  });

  it("期限から遠い時期は空を返す", () => {
    expect(
      filingDeadlineAlerts({
        ...base,
        asOf: "2026-11-02",
        hasDepreciableAssets: true,
      }),
    ).toEqual([]);
  });

  it("不正な asOf はエラーにする", () => {
    expect(() =>
      filingDeadlineAlerts({ ...base, asOf: "2026-13-01" }),
    ).toThrow();
  });
});
