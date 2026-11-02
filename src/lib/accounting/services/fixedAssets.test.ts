import { describe, expect, it } from "vitest";
import { seedClosedPeriod, setupStore } from "../testing";
import type { FixedAsset } from "../types";
import {
  bookCurrentYearDepreciation,
  disposeFixedAsset,
  registerFixedAsset,
  updateFixedAsset,
  type FixedAssetFields,
} from "./fixedAssets";

const base: FixedAssetFields = {
  name: "複合機",
  acquiredDate: "2025-01-15",
  acquisitionCost: 300_000,
  usefulLifeYears: 5,
  method: "straightLine" as const,
  businessRatio: 100,
};

async function makeAsset(
  overrides: Partial<typeof base> = {},
  fiscalYearStartMonth = 1,
): Promise<{
  store: Awaited<ReturnType<typeof setupStore>>["store"];
  businessId: string;
  actor: Awaited<ReturnType<typeof setupStore>>["actor"];
  asset: FixedAsset;
}> {
  const env = await setupStore(fiscalYearStartMonth);
  const { asset } = await registerFixedAsset(
    env.store,
    env.businessId,
    env.actor,
    { idempotencyKey: `fa-${Math.random()}`, ...base, ...overrides },
  );
  return { ...env, asset };
}

describe("registerFixedAsset", () => {
  it("active で登録される", async () => {
    const { store, businessId, actor } = await setupStore();
    const { asset, replayed } = await registerFixedAsset(
      store,
      businessId,
      actor,
      { idempotencyKey: "fa-1", ...base },
    );
    expect(replayed).toBe(false);
    expect(asset.status).toBe("active");
    expect(asset.lastBookedFiscalYear).toBeUndefined();
    expect(asset.createdBy).toBe(actor.uid);
    const saved = await store.getFixedAsset(businessId, asset.id);
    expect(saved?.name).toBe("複合機");
  });

  it("不正な値を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    const cases: [Partial<typeof base>, string][] = [
      [{ name: "" }, "INVALID_INPUT"],
      [{ acquiredDate: "2025-13-01" }, "INVALID_DATE"],
      [{ acquisitionCost: 0 }, "INVALID_AMOUNT"],
      [{ usefulLifeYears: 0 }, "INVALID_INPUT"],
      [{ method: "foo" as never }, "INVALID_INPUT"],
      [{ businessRatio: 101 }, "INVALID_INPUT"],
      [{ businessRatio: -1 }, "INVALID_INPUT"],
    ];
    for (const [patch, code] of cases) {
      await expect(
        registerFixedAsset(store, businessId, actor, {
          idempotencyKey: `fa-bad-${code}-${Math.random()}`,
          ...base,
          ...patch,
        }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("同じ idempotencyKey の再実行は二重登録しない", async () => {
    const { store, businessId, actor } = await setupStore();
    const first = await registerFixedAsset(store, businessId, actor, {
      idempotencyKey: "fa-dup",
      ...base,
    });
    const second = await registerFixedAsset(store, businessId, actor, {
      idempotencyKey: "fa-dup",
      ...base,
      name: "別名",
    });
    expect(second.replayed).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(await store.listFixedAssets(businessId)).toHaveLength(1);
  });
});

describe("updateFixedAsset / disposeFixedAsset", () => {
  it("内容を更新できる", async () => {
    const { store, businessId, actor, asset } = await makeAsset();
    const { asset: next } = await updateFixedAsset(
      store,
      businessId,
      actor,
      asset.id,
      { ...base, acquisitionCost: 480_000, businessRatio: 50 },
    );
    expect(next.acquisitionCost).toBe(480_000);
    expect(next.businessRatio).toBe(50);
    expect(next.status).toBe("active");
    expect(next.createdBy).toBe(asset.createdBy);
  });

  it("除却できる。除却日が取得日より前なら拒否", async () => {
    const { store, businessId, actor, asset } = await makeAsset();
    const { asset: disposed } = await disposeFixedAsset(
      store,
      businessId,
      actor,
      asset.id,
      "2026-08-20",
    );
    expect(disposed.status).toBe("disposed");
    expect(disposed.disposedDate).toBe("2026-08-20");

    // 再実行は冪等
    const again = await disposeFixedAsset(
      store,
      businessId,
      actor,
      asset.id,
      "2026-09-01",
    );
    expect(again.asset.disposedDate).toBe("2026-08-20");

    const other = await makeAsset();
    await expect(
      disposeFixedAsset(
        other.store,
        other.businessId,
        other.actor,
        other.asset.id,
        "2024-12-31",
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("存在しない資産は NOT_FOUND", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      updateFixedAsset(store, businessId, actor, "missing", base),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      disposeFixedAsset(store, businessId, actor, "missing", "2026-01-01"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("bookCurrentYearDepreciation", () => {
  it("当年分の償却費をdraft取引として生成する", async () => {
    const { store, businessId, actor, asset } = await makeAsset();
    const { transactions, fiscalYear } =
      await bookCurrentYearDepreciation(
        store,
        businessId,
        actor,
        "2025-10-01",
      );
    expect(fiscalYear).toBe(2025);
    expect(transactions).toHaveLength(1);
    const tx = transactions[0];
    expect(tx.id).toBe(`depreciation-${asset.id}-2025`);
    expect(tx.date).toBe("2025-12-31");
    // 2025-01取得・暦年: 12か月 → 300,000/5 = 60,000
    expect(tx.amount).toBe(60_000);
    expect(tx.type).toBe("expense");
    expect(tx.account).toBe("depreciation");
    expect(tx.status).toBe("draft");
    expect(tx.description).toContain("複合機");

    const next = await store.getFixedAsset(businessId, asset.id);
    expect(next?.lastBookedFiscalYear).toBe(2025);
  });

  it("事業割合を適用した金額で計上する", async () => {
    const { store, businessId, actor } = await makeAsset({
      businessRatio: 80,
    });
    const { transactions } = await bookCurrentYearDepreciation(
      store,
      businessId,
      actor,
      "2025-10-01",
    );
    // 60,000 × 80% = 48,000
    expect(transactions[0].amount).toBe(48_000);
    expect(transactions[0].description).toContain("事業割合80%");
  });

  it("同じ年度の再実行では生成しない(冪等)", async () => {
    const { store, businessId, actor, asset } = await makeAsset();
    await bookCurrentYearDepreciation(store, businessId, actor, "2025-10-01");
    const again = await bookCurrentYearDepreciation(
      store,
      businessId,
      actor,
      "2025-12-01",
    );
    expect(again.transactions).toHaveLength(0);
    const all = await store.listTransactionsInRange(
      businessId,
      "2025-01-01",
      "2025-12-31",
    );
    expect(all).toHaveLength(1);
    const next = await store.getFixedAsset(businessId, asset.id);
    expect(next?.lastBookedFiscalYear).toBe(2025);
  });

  it("翌年度は再度計上される", async () => {
    const { store, businessId, actor } = await makeAsset();
    await bookCurrentYearDepreciation(store, businessId, actor, "2025-10-01");
    const next = await bookCurrentYearDepreciation(
      store,
      businessId,
      actor,
      "2026-04-01",
    );
    expect(next.fiscalYear).toBe(2026);
    expect(next.transactions).toHaveLength(1);
    expect(next.transactions[0].date).toBe("2026-12-31");
  });

  it("除却した資産は除却月までの月割りで計上し翌年は対象外", async () => {
    const env = await makeAsset({ acquiredDate: "2025-01-15" });
    await disposeFixedAsset(
      env.store,
      env.businessId,
      env.actor,
      env.asset.id,
      "2026-08-20",
    );
    const { transactions } = await bookCurrentYearDepreciation(
      env.store,
      env.businessId,
      env.actor,
      "2026-10-01",
    );
    // 8か月保有 → 60,000×8/12=40,000
    expect(transactions[0].amount).toBe(40_000);
    const next = await bookCurrentYearDepreciation(
      env.store,
      env.businessId,
      env.actor,
      "2027-10-01",
    );
    expect(next.transactions).toHaveLength(0);
  });

  it("定率法の償却費で計上する", async () => {
    const { store, businessId, actor } = await makeAsset({
      method: "decliningBalance",
      acquiredDate: "2025-06-01",
    });
    const { transactions } = await bookCurrentYearDepreciation(
      store,
      businessId,
      actor,
      "2025-10-01",
    );
    // 300,000 × 0.4 × 7/12 = 70,000
    expect(transactions[0].amount).toBe(70_000);
  });

  it("closed期間への計上は拒否される", async () => {
    const { store, businessId, actor } = await makeAsset();
    await seedClosedPeriod(store, businessId, {
      id: "fy2025",
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    await expect(
      bookCurrentYearDepreciation(store, businessId, actor, "2025-10-01"),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
});
