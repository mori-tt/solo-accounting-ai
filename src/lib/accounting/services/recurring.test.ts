import { describe, expect, it } from "vitest";
import { seedClosedPeriod, setupStore } from "../testing";
import type { RecurringTemplate } from "../types";
import {
  generateRecurringTransactions,
  registerRecurringTemplate,
  setRecurringTemplateActive,
  updateRecurringTemplate,
} from "./recurring";

const base = {
  name: "事務所家賃",
  type: "expense" as const,
  account: "rent",
  counterparty: "大家",
  description: "毎月の家賃",
  amount: 100_000,
  dayOfMonth: 25,
};

async function makeTemplate(
  overrides: Partial<typeof base> = {},
): Promise<{
  store: Awaited<ReturnType<typeof setupStore>>["store"];
  businessId: string;
  actor: Awaited<ReturnType<typeof setupStore>>["actor"];
  template: RecurringTemplate;
}> {
  const env = await setupStore();
  const { template } = await registerRecurringTemplate(
    env.store,
    env.businessId,
    env.actor,
    { idempotencyKey: `rt-${Math.random()}`, ...base, ...overrides },
  );
  return { ...env, template };
}

describe("registerRecurringTemplate", () => {
  it("active=true で登録される", async () => {
    const { store, businessId, actor } = await setupStore();
    const { template, replayed } = await registerRecurringTemplate(
      store,
      businessId,
      actor,
      { idempotencyKey: "rt-1", ...base },
    );
    expect(replayed).toBe(false);
    expect(template.active).toBe(true);
    expect(template.lastGeneratedMonth).toBeUndefined();
    expect(template.createdBy).toBe(actor.uid);
    const saved = await store.getRecurringTemplate(businessId, template.id);
    expect(saved?.name).toBe("事務所家賃");
  });

  it("不正な値を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      registerRecurringTemplate(store, businessId, actor, {
        idempotencyKey: "rt-bad1",
        ...base,
        dayOfMonth: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      registerRecurringTemplate(store, businessId, actor, {
        idempotencyKey: "rt-bad2",
        ...base,
        dayOfMonth: 32,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      registerRecurringTemplate(store, businessId, actor, {
        idempotencyKey: "rt-bad3",
        ...base,
        amount: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(
      registerRecurringTemplate(store, businessId, actor, {
        idempotencyKey: "rt-bad4",
        ...base,
        name: "",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("同じ idempotencyKey の再実行は二重登録しない", async () => {
    const { store, businessId, actor } = await setupStore();
    const first = await registerRecurringTemplate(store, businessId, actor, {
      idempotencyKey: "rt-dup",
      ...base,
    });
    const second = await registerRecurringTemplate(store, businessId, actor, {
      idempotencyKey: "rt-dup",
      ...base,
      name: "別名",
    });
    expect(second.replayed).toBe(true);
    expect(second.template.id).toBe(first.template.id);
    expect(await store.listRecurringTemplates(businessId)).toHaveLength(1);
  });
});

describe("updateRecurringTemplate / setRecurringTemplateActive", () => {
  it("内容を更新できる", async () => {
    const { store, businessId, actor, template } = await makeTemplate();
    const { template: next } = await updateRecurringTemplate(
      store,
      businessId,
      actor,
      template.id,
      { ...base, amount: 120_000, dayOfMonth: 1, active: false },
    );
    expect(next.amount).toBe(120_000);
    expect(next.dayOfMonth).toBe(1);
    expect(next.active).toBe(false);
    expect(next.createdBy).toBe(template.createdBy);
    expect(next.createdAt).toBe(template.createdAt);
  });

  it("存在しないテンプレートは NOT_FOUND", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      updateRecurringTemplate(store, businessId, actor, "missing", {
        ...base,
        active: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      setRecurringTemplateActive(store, businessId, actor, "missing", false),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("有効/無効を切り替えられる", async () => {
    const { store, businessId, actor, template } = await makeTemplate();
    const off = await setRecurringTemplateActive(
      store,
      businessId,
      actor,
      template.id,
      false,
    );
    expect(off.template.active).toBe(false);
    const on = await setRecurringTemplateActive(
      store,
      businessId,
      actor,
      template.id,
      true,
    );
    expect(on.template.active).toBe(true);
  });
});

describe("generateRecurringTransactions", () => {
  it("active なテンプレートから draft 取引を生成する", async () => {
    const { store, businessId, actor, template } = await makeTemplate();
    const { transactions } = await generateRecurringTransactions(
      store,
      businessId,
      actor,
      "202611",
    );
    expect(transactions).toHaveLength(1);
    const tx = transactions[0];
    expect(tx.date).toBe("2026-11-25");
    expect(tx.amount).toBe(100_000);
    expect(tx.account).toBe("rent");
    expect(tx.status).toBe("draft");

    const next = await store.getRecurringTemplate(businessId, template.id);
    expect(next?.lastGeneratedMonth).toBe("202611");
  });

  it("dayOfMonth が月の日数を超える場合は月末へ調整する", async () => {
    const { store, businessId, actor } = await makeTemplate({
      dayOfMonth: 31,
    });
    const { transactions } = await generateRecurringTransactions(
      store,
      businessId,
      actor,
      "202602",
    );
    expect(transactions[0].date).toBe("2026-02-28");
  });

  it("同じ月の再実行では生成しない(冪等)", async () => {
    const { store, businessId, actor } = await makeTemplate();
    await generateRecurringTransactions(store, businessId, actor, "202611");
    const again = await generateRecurringTransactions(
      store,
      businessId,
      actor,
      "202611",
    );
    expect(again.transactions).toHaveLength(0);
    const all = await store.listTransactionsInRange(
      businessId,
      "2026-11-01",
      "2026-11-30",
    );
    expect(all).toHaveLength(1);
  });

  it("翌月は再度生成される", async () => {
    const { store, businessId, actor } = await makeTemplate();
    await generateRecurringTransactions(store, businessId, actor, "202611");
    const next = await generateRecurringTransactions(
      store,
      businessId,
      actor,
      "202612",
    );
    expect(next.transactions).toHaveLength(1);
    expect(next.transactions[0].date).toBe("2026-12-25");
  });

  it("無効化したテンプレートは生成対象外", async () => {
    const { store, businessId, actor, template } = await makeTemplate();
    await setRecurringTemplateActive(store, businessId, actor, template.id, false);
    const { transactions } = await generateRecurringTransactions(
      store,
      businessId,
      actor,
      "202611",
    );
    expect(transactions).toHaveLength(0);
  });

  it("closed期間の月への生成は拒否される", async () => {
    const { store, businessId, actor } = await makeTemplate();
    await seedClosedPeriod(store, businessId, {
      id: "fy2026",
      fiscalYear: 2026,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    await expect(
      generateRecurringTransactions(store, businessId, actor, "202611"),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("不正な月キーを拒否する", async () => {
    const { store, businessId, actor } = await makeTemplate();
    await expect(
      generateRecurringTransactions(store, businessId, actor, "202613"),
    ).rejects.toMatchObject({ code: "INVALID_DATE" });
  });
});
