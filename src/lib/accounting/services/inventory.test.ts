import { describe, expect, it } from "vitest";
import { seedClosedPeriod, setupStore } from "../testing";
import type { InventoryItem } from "../types";
import {
  deleteInventoryItem,
  inventoryCountId,
  registerInventoryItem,
  saveInventoryCount,
  updateInventoryItem,
  type InventoryItemFields,
} from "./inventory";

const base: InventoryItemFields = {
  name: "商品A",
  unit: "個",
  standardUnitPrice: 1000,
};

async function makeItem(
  overrides: Partial<typeof base> = {},
): Promise<{
  store: Awaited<ReturnType<typeof setupStore>>["store"];
  businessId: string;
  actor: Awaited<ReturnType<typeof setupStore>>["actor"];
  item: InventoryItem;
}> {
  const env = await setupStore();
  const { item } = await registerInventoryItem(
    env.store,
    env.businessId,
    env.actor,
    { idempotencyKey: `inv-${Math.random()}`, ...base, ...overrides },
  );
  return { ...env, item };
}

describe("registerInventoryItem", () => {
  it("品目を登録する", async () => {
    const { store, businessId, actor } = await setupStore();
    const { item, replayed } = await registerInventoryItem(
      store,
      businessId,
      actor,
      { idempotencyKey: "inv-1", ...base },
    );
    expect(replayed).toBe(false);
    expect(item.name).toBe("商品A");
    expect(item.unit).toBe("個");
    expect(item.standardUnitPrice).toBe(1000);
    expect(item.createdBy).toBe(actor.uid);
    const saved = await store.getInventoryItem(businessId, item.id);
    expect(saved?.name).toBe("商品A");
  });

  it("不正な値を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    const cases: [Partial<typeof base>, string][] = [
      [{ name: "" }, "INVALID_INPUT"],
      [{ unit: "" }, "INVALID_INPUT"],
      [{ standardUnitPrice: -1 }, "INVALID_AMOUNT"],
      [{ standardUnitPrice: 1.5 }, "INVALID_AMOUNT"],
    ];
    for (const [patch, code] of cases) {
      await expect(
        registerInventoryItem(store, businessId, actor, {
          idempotencyKey: `inv-bad-${code}-${Math.random()}`,
          ...base,
          ...patch,
        }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("標準単価0円は許容する", async () => {
    const { item } = await makeItem({ standardUnitPrice: 0 });
    expect(item.standardUnitPrice).toBe(0);
  });

  it("同じ idempotencyKey の再実行は二重登録しない", async () => {
    const { store, businessId, actor } = await setupStore();
    const first = await registerInventoryItem(store, businessId, actor, {
      idempotencyKey: "inv-dup",
      ...base,
    });
    const second = await registerInventoryItem(store, businessId, actor, {
      idempotencyKey: "inv-dup",
      ...base,
      name: "別名",
    });
    expect(second.replayed).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    expect(await store.listInventoryItems(businessId)).toHaveLength(1);
  });
});

describe("updateInventoryItem / deleteInventoryItem", () => {
  it("内容を更新できる", async () => {
    const { store, businessId, actor, item } = await makeItem();
    const { item: next } = await updateInventoryItem(
      store,
      businessId,
      actor,
      item.id,
      { name: "商品A改", unit: "箱", standardUnitPrice: 2000 },
    );
    expect(next.name).toBe("商品A改");
    expect(next.unit).toBe("箱");
    expect(next.standardUnitPrice).toBe(2000);
    expect(next.createdBy).toBe(item.createdBy);
    expect(next.createdAt).toBe(item.createdAt);
  });

  it("存在しない品目は NOT_FOUND", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      updateInventoryItem(store, businessId, actor, "missing", base),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("削除できる。再実行は冪等", async () => {
    const { store, businessId, actor, item } = await makeItem();
    const first = await deleteInventoryItem(store, businessId, actor, item.id);
    expect(first.deleted).toBe(true);
    expect(await store.getInventoryItem(businessId, item.id)).toBeUndefined();
    const second = await deleteInventoryItem(
      store,
      businessId,
      actor,
      item.id,
    );
    expect(second.deleted).toBe(false);
  });
});

describe("saveInventoryCount", () => {
  it("年度の棚卸カウントを fy{year} IDで保存する", async () => {
    const { store, businessId, actor, item } = await makeItem();
    const { item: item2 } = await registerInventoryItem(
      store,
      businessId,
      actor,
      { idempotencyKey: "inv-2", name: "商品B", unit: "本", standardUnitPrice: 500 },
    );
    const { count } = await saveInventoryCount(store, businessId, actor, {
      fiscalYear: 2026,
      lines: [
        { itemId: item.id, quantity: 3 },
        { itemId: item2.id, quantity: 4, unitPrice: 600 },
      ],
    });
    expect(count.id).toBe("fy2026");
    expect(count.fiscalYear).toBe(2026);
    expect(count.lines).toHaveLength(2);
    // 単価省略時は標準単価を採用し、品目名・単位をスナップショットする
    expect(count.lines[0]).toMatchObject({
      itemId: item.id,
      name: "商品A",
      unit: "個",
      quantity: 3,
      unitPrice: 1000,
    });
    expect(count.lines[1].unitPrice).toBe(600);
    const saved = await store.getInventoryCount(businessId, "fy2026");
    expect(saved?.lines).toHaveLength(2);
  });

  it("再保存で上書きし createdBy/createdAt を維持する", async () => {
    const { store, businessId, actor, item } = await makeItem();
    const first = await saveInventoryCount(store, businessId, actor, {
      fiscalYear: 2026,
      lines: [{ itemId: item.id, quantity: 3 }],
    });
    const second = await saveInventoryCount(store, businessId, actor, {
      fiscalYear: 2026,
      lines: [{ itemId: item.id, quantity: 10, unitPrice: 900 }],
    });
    expect(second.count.lines[0].quantity).toBe(10);
    expect(second.count.lines[0].unitPrice).toBe(900);
    expect(second.count.createdBy).toBe(first.count.createdBy);
    expect(second.count.createdAt).toBe(first.count.createdAt);
    expect(
      await store.listInventoryCounts(businessId),
    ).toHaveLength(1);
  });

  it("明細なし(空)も保存できる", async () => {
    const { store, businessId, actor } = await makeItem();
    const { count } = await saveInventoryCount(store, businessId, actor, {
      fiscalYear: 2026,
      lines: [],
    });
    expect(count.lines).toHaveLength(0);
  });

  it("存在しない品目・重複・不正数量を拒否する", async () => {
    const { store, businessId, actor, item } = await makeItem();
    await expect(
      saveInventoryCount(store, businessId, actor, {
        fiscalYear: 2026,
        lines: [{ itemId: "missing", quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      saveInventoryCount(store, businessId, actor, {
        fiscalYear: 2026,
        lines: [
          { itemId: item.id, quantity: 1 },
          { itemId: item.id, quantity: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      saveInventoryCount(store, businessId, actor, {
        fiscalYear: 2026,
        lines: [{ itemId: item.id, quantity: -1 }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    await expect(
      saveInventoryCount(store, businessId, actor, {
        fiscalYear: 2026,
        lines: [{ itemId: item.id, quantity: 1, unitPrice: -5 }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(
      saveInventoryCount(store, businessId, actor, {
        fiscalYear: 99,
        lines: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("品目削除後も保存済み明細の品目名・単位は変わらない", async () => {
    const { store, businessId, actor, item } = await makeItem();
    await saveInventoryCount(store, businessId, actor, {
      fiscalYear: 2026,
      lines: [{ itemId: item.id, quantity: 2 }],
    });
    await deleteInventoryItem(store, businessId, actor, item.id);
    const count = await store.getInventoryCount(businessId, "fy2026");
    expect(count?.lines[0].name).toBe("商品A");
    expect(count?.lines[0].unit).toBe("個");
  });

  it("締め済み年度のカウントは保存できない", async () => {
    const { store, businessId, actor, item } = await makeItem();
    await seedClosedPeriod(store, businessId, {
      id: "fy2025",
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    await expect(
      saveInventoryCount(store, businessId, actor, {
        fiscalYear: 2025,
        lines: [{ itemId: item.id, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    // 未締め年度は保存できる
    const ok = await saveInventoryCount(store, businessId, actor, {
      fiscalYear: 2026,
      lines: [{ itemId: item.id, quantity: 1 }],
    });
    expect(ok.count.fiscalYear).toBe(2026);
  });
});

describe("inventoryCountId", () => {
  it("fy{year} 形式", () => {
    expect(inventoryCountId(2026)).toBe("fy2026");
  });
});
