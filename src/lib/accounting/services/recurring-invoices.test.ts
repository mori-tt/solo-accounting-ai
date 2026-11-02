import { describe, expect, it } from "vitest";
import { seedClosedPeriod, setupStore } from "../testing";
import type { RecurringInvoiceTemplate } from "../types";
import {
  generateRecurringInvoices,
  registerRecurringInvoiceTemplate,
  setRecurringInvoiceTemplateActive,
  updateRecurringInvoiceTemplate,
  type RegisterRecurringInvoiceTemplateInput,
} from "./recurring-invoices";
import { registerCustomer, registerInvoice } from "./sales";

type TemplateOverrides = Partial<
  Omit<RegisterRecurringInvoiceTemplateInput, "idempotencyKey">
>;

const base = {
  name: "顧問料",
  customerId: "cust-1",
  items: [
    {
      description: "顧問料(月額)",
      quantity: 1,
      unitPrice: 50_000,
      amount: 50_000,
    },
  ],
  intervalMonths: 1,
  dayOfMonth: 25,
  startDate: "2026-01-01",
  dueDays: 30,
};

async function makeTemplate(
  overrides: TemplateOverrides = {},
): Promise<{
  store: Awaited<ReturnType<typeof setupStore>>["store"];
  businessId: string;
  actor: Awaited<ReturnType<typeof setupStore>>["actor"];
  template: RecurringInvoiceTemplate;
}> {
  const env = await setupStore();
  await registerCustomer(env.store, env.businessId, env.actor, {
    id: "cust-1",
    name: "顧客A",
  });
  const { template } = await registerRecurringInvoiceTemplate(
    env.store,
    env.businessId,
    env.actor,
    { idempotencyKey: `rit-${Math.random()}`, ...base, ...overrides },
  );
  return { ...env, template };
}

describe("registerRecurringInvoiceTemplate", () => {
  it("active=true・generatedCount=0 で登録され、明細は正規化される", async () => {
    const { store, businessId, actor } = await setupStore();
    await registerCustomer(store, businessId, actor, {
      id: "cust-1",
      name: "顧客A",
    });
    const { template, replayed } = await registerRecurringInvoiceTemplate(
      store,
      businessId,
      actor,
      { idempotencyKey: "rit-1", ...base },
    );
    expect(replayed).toBe(false);
    expect(template.active).toBe(true);
    expect(template.generatedCount).toBe(0);
    expect(template.lastGeneratedMonth).toBeUndefined();
    expect(template.createdBy).toBe(actor.uid);
    expect(template.items[0].taxRate).toBe("standard");
    expect(template.items[0].taxAmount).toBe(4_545);
    const saved = await store.getRecurringInvoiceTemplate(
      businessId,
      template.id,
    );
    expect(saved?.name).toBe("顧問料");
  });

  it("不正な値を拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, {
      id: "cust-1",
      name: "顧客A",
    });
    const cases: [string, TemplateOverrides, string][] = [
      ["name-empty", { name: "" }, "INVALID_INPUT"],
      ["customer-empty", { customerId: "" }, "INVALID_INPUT"],
      ["items-empty", { items: [] }, "INVALID_INPUT"],
      ["interval-0", { intervalMonths: 0 }, "INVALID_INPUT"],
      ["interval-37", { intervalMonths: 37 }, "INVALID_INPUT"],
      ["dom-0", { dayOfMonth: 0 }, "INVALID_INPUT"],
      ["dom-32", { dayOfMonth: 32 }, "INVALID_INPUT"],
      ["start-bad", { startDate: "2026-13-01" }, "INVALID_DATE"],
      [
        "end-before-start",
        { endDate: "2025-12-31", startDate: "2026-01-01" },
        "INVALID_INPUT",
      ],
      ["max-0", { maxOccurrences: 0 }, "INVALID_INPUT"],
      ["due-neg", { dueDays: -1 }, "INVALID_INPUT"],
      ["due-367", { dueDays: 367 }, "INVALID_INPUT"],
    ];
    for (const [key, overrides, code] of cases) {
      await expect(
        registerRecurringInvoiceTemplate(store, businessId, actor, {
          idempotencyKey: `rit-${key}`,
          ...base,
          ...overrides,
        }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("存在しない顧客・案件を拒否する", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      registerRecurringInvoiceTemplate(store, businessId, actor, {
        idempotencyKey: "rit-nocust",
        ...base,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await registerCustomer(store, businessId, actor, {
      id: "cust-1",
      name: "顧客A",
    });
    await expect(
      registerRecurringInvoiceTemplate(store, businessId, actor, {
        idempotencyKey: "rit-noproj",
        ...base,
        projectId: "missing",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("同じ idempotencyKey の再実行は二重登録しない", async () => {
    const { store, businessId, actor } = await setupStore();
    await registerCustomer(store, businessId, actor, {
      id: "cust-1",
      name: "顧客A",
    });
    const first = await registerRecurringInvoiceTemplate(
      store,
      businessId,
      actor,
      { idempotencyKey: "rit-dup", ...base },
    );
    const second = await registerRecurringInvoiceTemplate(
      store,
      businessId,
      actor,
      { idempotencyKey: "rit-dup", ...base, name: "別名" },
    );
    expect(second.replayed).toBe(true);
    expect(second.template.id).toBe(first.template.id);
    expect(
      await store.listRecurringInvoiceTemplates(businessId),
    ).toHaveLength(1);
  });
});

describe("updateRecurringInvoiceTemplate / setRecurringInvoiceTemplateActive", () => {
  it("内容を更新できる", async () => {
    const { store, businessId, actor, template } = await makeTemplate();
    const { template: next } = await updateRecurringInvoiceTemplate(
      store,
      businessId,
      actor,
      template.id,
      { ...base, dayOfMonth: 1, dueDays: 60, intervalMonths: 3, active: false },
    );
    expect(next.dayOfMonth).toBe(1);
    expect(next.dueDays).toBe(60);
    expect(next.intervalMonths).toBe(3);
    expect(next.active).toBe(false);
    expect(next.createdBy).toBe(template.createdBy);
    expect(next.createdAt).toBe(template.createdAt);
  });

  it("存在しないテンプレートは NOT_FOUND", async () => {
    const { store, businessId, actor } = await setupStore();
    await expect(
      updateRecurringInvoiceTemplate(store, businessId, actor, "missing", {
        ...base,
        active: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      setRecurringInvoiceTemplateActive(
        store,
        businessId,
        actor,
        "missing",
        false,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("有効/無効を切り替えられる", async () => {
    const { store, businessId, actor, template } = await makeTemplate();
    const off = await setRecurringInvoiceTemplateActive(
      store,
      businessId,
      actor,
      template.id,
      false,
    );
    expect(off.template.active).toBe(false);
    const on = await setRecurringInvoiceTemplateActive(
      store,
      businessId,
      actor,
      template.id,
      true,
    );
    expect(on.template.active).toBe(true);
  });
});

describe("generateRecurringInvoices", () => {
  it("active なテンプレートから draft 請求書を連番付きで生成する", async () => {
    const { store, businessId, actor, template } = await makeTemplate();
    const { invoices } = await generateRecurringInvoices(
      store,
      businessId,
      actor,
      "202611",
    );
    expect(invoices).toHaveLength(1);
    const inv = invoices[0];
    expect(inv.id).toBe(`recurring-invoice-${template.id}-202611`);
    expect(inv.invoiceNumber).toBe("INV-000001");
    expect(inv.issueDate).toBe("2026-11-25");
    expect(inv.dueDate).toBe("2026-12-25");
    expect(inv.customerId).toBe("cust-1");
    expect(inv.totalAmount).toBe(50_000);
    expect(inv.taxAmount).toBe(4_545);
    expect(inv.status).toBe("draft");

    const next = await store.getRecurringInvoiceTemplate(
      businessId,
      template.id,
    );
    expect(next?.lastGeneratedMonth).toBe("202611");
    expect(next?.generatedCount).toBe(1);
  });

  it("dayOfMonth が月の日数を超える場合は月末へ調整する", async () => {
    const { store, businessId, actor } = await makeTemplate({
      dayOfMonth: 31,
    });
    const { invoices } = await generateRecurringInvoices(
      store,
      businessId,
      actor,
      "202602",
    );
    expect(invoices[0].issueDate).toBe("2026-02-28");
  });

  it("同じ月の再実行では生成しない(冪等)", async () => {
    const { store, businessId, actor } = await makeTemplate();
    await generateRecurringInvoices(store, businessId, actor, "202611");
    const again = await generateRecurringInvoices(
      store,
      businessId,
      actor,
      "202611",
    );
    expect(again.invoices).toHaveLength(0);
    expect(await store.listInvoices(businessId)).toHaveLength(1);
  });

  it("翌月は新しい請求書番号で再度生成される", async () => {
    const { store, businessId, actor } = await makeTemplate();
    await generateRecurringInvoices(store, businessId, actor, "202611");
    const next = await generateRecurringInvoices(
      store,
      businessId,
      actor,
      "202612",
    );
    expect(next.invoices).toHaveLength(1);
    expect(next.invoices[0].issueDate).toBe("2026-12-25");
    expect(next.invoices[0].invoiceNumber).toBe("INV-000002");
  });

  it("intervalMonths=3 は起点月から3か月ごとのみ生成する", async () => {
    const { store, businessId, actor } = await makeTemplate({
      intervalMonths: 3,
      startDate: "2026-01-01",
    });
    // 起点月(1月)・4月は生成、2月・3月はスキップ
    expect(
      (await generateRecurringInvoices(store, businessId, actor, "202601"))
        .invoices,
    ).toHaveLength(1);
    expect(
      (await generateRecurringInvoices(store, businessId, actor, "202602"))
        .invoices,
    ).toHaveLength(0);
    expect(
      (await generateRecurringInvoices(store, businessId, actor, "202603"))
        .invoices,
    ).toHaveLength(0);
    expect(
      (await generateRecurringInvoices(store, businessId, actor, "202604"))
        .invoices,
    ).toHaveLength(1);
    expect(await store.listInvoices(businessId)).toHaveLength(2);
  });

  it("発行日が startDate 未満の月は生成しない", async () => {
    const { store, businessId, actor } = await makeTemplate({
      dayOfMonth: 10,
      startDate: "2026-11-20",
    });
    // 2026-11-10 < startDate → 11月はスキップ、12月から生成
    expect(
      (await generateRecurringInvoices(store, businessId, actor, "202611"))
        .invoices,
    ).toHaveLength(0);
    expect(
      (await generateRecurringInvoices(store, businessId, actor, "202612"))
        .invoices,
    ).toHaveLength(1);
  });

  it("発行日が endDate を超える月は生成しない", async () => {
    const { store, businessId, actor } = await makeTemplate({
      endDate: "2026-11-30",
    });
    expect(
      (await generateRecurringInvoices(store, businessId, actor, "202611"))
        .invoices,
    ).toHaveLength(1);
    expect(
      (await generateRecurringInvoices(store, businessId, actor, "202612"))
        .invoices,
    ).toHaveLength(0);
  });

  it("maxOccurrences に達したら生成しない", async () => {
    const { store, businessId, actor } = await makeTemplate({
      maxOccurrences: 2,
    });
    await generateRecurringInvoices(store, businessId, actor, "202611");
    await generateRecurringInvoices(store, businessId, actor, "202612");
    const third = await generateRecurringInvoices(
      store,
      businessId,
      actor,
      "202701",
    );
    expect(third.invoices).toHaveLength(0);
    expect(await store.listInvoices(businessId)).toHaveLength(2);
    const t = (await store.listRecurringInvoiceTemplates(businessId))[0];
    expect(t.generatedCount).toBe(2);
  });

  it("無効化したテンプレートは生成対象外", async () => {
    const { store, businessId, actor, template } = await makeTemplate();
    await setRecurringInvoiceTemplateActive(
      store,
      businessId,
      actor,
      template.id,
      false,
    );
    const { invoices } = await generateRecurringInvoices(
      store,
      businessId,
      actor,
      "202611",
    );
    expect(invoices).toHaveLength(0);
  });

  it("複数テンプレートは連番が順に振られる", async () => {
    const env = await makeTemplate();
    const { store, businessId, actor } = env;
    await registerRecurringInvoiceTemplate(store, businessId, actor, {
      idempotencyKey: "rit-second",
      ...base,
      name: "保守料",
    });
    const { invoices } = await generateRecurringInvoices(
      store,
      businessId,
      actor,
      "202611",
    );
    expect(invoices).toHaveLength(2);
    const numbers = invoices.map((i) => i.invoiceNumber).sort();
    expect(numbers).toEqual(["INV-000001", "INV-000002"]);
  });

  it("既存請求書の連番を引き継ぐ", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, {
      id: "cust-1",
      name: "顧客A",
    });
    await registerInvoice(store, businessId, actor, {
      idempotencyKey: "inv-manual",
      customerId: "cust-1",
      issueDate: "2026-10-01",
      dueDate: "2026-10-31",
      items: [{ description: "個別", quantity: 1, unitPrice: 10_000, amount: 10_000 }],
    });
    await registerRecurringInvoiceTemplate(store, businessId, actor, {
      idempotencyKey: "rit-seq",
      ...base,
    });
    const { invoices } = await generateRecurringInvoices(
      store,
      businessId,
      actor,
      "202611",
    );
    expect(invoices[0].invoiceNumber).toBe("INV-000002");
    const business = await store.getBusiness(businessId);
    expect(business?.invoiceCounter).toBe(2);
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
      generateRecurringInvoices(store, businessId, actor, "202611"),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("不正な月キーを拒否する", async () => {
    const { store, businessId, actor } = await makeTemplate();
    await expect(
      generateRecurringInvoices(store, businessId, actor, "202613"),
    ).rejects.toMatchObject({ code: "INVALID_DATE" });
  });
});
