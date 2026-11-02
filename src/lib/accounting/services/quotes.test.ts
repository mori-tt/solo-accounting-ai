import { describe, expect, it } from "vitest";
import { setupStore, seedClosedPeriod } from "../testing";
import { registerCustomer, registerProject } from "./sales";
import {
  convertQuoteToInvoice,
  markQuoteAccepted,
  markQuoteSent,
  registerQuote,
  updateQuote,
} from "./quotes";

const items = [
  { description: "開発費", quantity: 2, unitPrice: 100_000, amount: 200_000 },
  { description: "保守", quantity: 1, unitPrice: 30_000, amount: 30_000 },
];

async function seedQuote(status?: "sent" | "accepted") {
  const env = await setupStore();
  const { store, businessId, actor } = env;
  const { customer } = await registerCustomer(store, businessId, actor, {
    id: "cust-1",
    name: "顧客A",
  });
  const { quote } = await registerQuote(store, businessId, actor, {
    idempotencyKey: "q-1",
    customerId: customer.id,
    issueDate: "2025-06-01",
    validUntil: "2025-06-30",
    items,
  });
  if (status === "sent" || status === "accepted") {
    await markQuoteSent(store, businessId, actor, quote.id);
  }
  if (status === "accepted") {
    await markQuoteAccepted(store, businessId, actor, quote.id);
  }
  const saved = await store.getQuote(businessId, quote.id);
  return { ...env, customer, quote: saved ?? quote };
}

describe("registerQuote", () => {
  it("items から合計を再計算して draft で登録する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    const { quote } = await registerQuote(store, businessId, actor, {
      idempotencyKey: "q-calc",
      customerId: "c",
      issueDate: "2025-06-01",
      validUntil: "2025-06-30",
      items,
    });
    expect(quote.totalAmount).toBe(230_000);
    expect(quote.status).toBe("draft");
    // 税額は請求書と同じ明細正規化(200,000→18,181 / 30,000→2,727)
    expect(quote.taxAmount).toBe(20_908);
  });

  it("見積番号を事業内連番で採番し、冪等リプレイでは消費しない", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    const first = await registerQuote(store, businessId, actor, {
      idempotencyKey: "q-seq-1",
      customerId: "c",
      issueDate: "2025-06-01",
      validUntil: "2025-06-30",
      items,
    });
    const second = await registerQuote(store, businessId, actor, {
      idempotencyKey: "q-seq-2",
      customerId: "c",
      issueDate: "2025-06-02",
      validUntil: "2025-07-02",
      items,
    });
    expect(first.quote.quoteNumber).toBe("EST-000001");
    expect(second.quote.quoteNumber).toBe("EST-000002");
    expect((await store.getBusiness(businessId))?.quoteCounter).toBe(2);

    const replay = await registerQuote(store, businessId, actor, {
      idempotencyKey: "q-seq-2",
      customerId: "c",
      issueDate: "2025-06-02",
      validUntil: "2025-07-02",
      items,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.quote.quoteNumber).toBe("EST-000002");
    expect((await store.getBusiness(businessId))?.quoteCounter).toBe(2);
  });

  it("validUntil が issueDate より前なら拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await expect(
      registerQuote(store, businessId, actor, {
        idempotencyKey: "q-dates",
        customerId: "c",
        issueDate: "2025-06-30",
        validUntil: "2025-06-01",
        items,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("存在しない顧客・案件は NOT_FOUND", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await expect(
      registerQuote(store, businessId, actor, {
        idempotencyKey: "q-nocust",
        customerId: "ghost",
        issueDate: "2025-06-01",
        validUntil: "2025-06-30",
        items,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await expect(
      registerQuote(store, businessId, actor, {
        idempotencyKey: "q-noproj",
        customerId: "c",
        projectId: "ghost",
        issueDate: "2025-06-01",
        validUntil: "2025-06-30",
        items,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("締め済み期間の発行日を拒否する", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    await registerCustomer(store, businessId, actor, { id: "c", name: "X" });
    await seedClosedPeriod(store, businessId, {
      id: "fy2025",
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    await expect(
      registerQuote(store, businessId, actor, {
        idempotencyKey: "q-closed",
        customerId: "c",
        issueDate: "2025-06-01",
        validUntil: "2025-06-30",
        items,
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });
});

describe("updateQuote / ステータス遷移", () => {
  it("draft の内容を更新し、合計を再計算する", async () => {
    const { store, businessId, actor, quote } = await seedQuote();
    const { quote: updated } = await updateQuote(
      store,
      businessId,
      actor,
      quote.id,
      {
        customerId: "cust-1",
        issueDate: "2025-06-05",
        validUntil: "2025-07-05",
        items: [
          {
            description: "改修費",
            quantity: 1,
            unitPrice: 50_000,
            amount: 50_000,
          },
        ],
        notes: "備考テスト",
      },
    );
    expect(updated.totalAmount).toBe(50_000);
    expect(updated.items[0].description).toBe("改修費");
    expect(updated.notes).toBe("備考テスト");
    // 見積番号は維持される
    expect(updated.quoteNumber).toBe(quote.quoteNumber);
  });

  it("sent 以降は更新できない", async () => {
    const { store, businessId, actor, quote } = await seedQuote("sent");
    await expect(
      updateQuote(store, businessId, actor, quote.id, {
        customerId: "cust-1",
        issueDate: "2025-06-05",
        validUntil: "2025-07-05",
        items,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });

  it("draft → sent → accepted と遷移し、再実行は冪等", async () => {
    const { store, businessId, actor, quote } = await seedQuote();
    // draft→accepted は飛び級のため不可
    await expect(
      markQuoteAccepted(store, businessId, actor, quote.id),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });

    const sent = await markQuoteSent(store, businessId, actor, quote.id);
    expect(sent.quote.status).toBe("sent");
    // 再実行は冪等
    const again = await markQuoteSent(store, businessId, actor, quote.id);
    expect(again.quote.status).toBe("sent");

    const accepted = await markQuoteAccepted(store, businessId, actor, quote.id);
    expect(accepted.quote.status).toBe("accepted");
  });
});

describe("convertQuoteToInvoice", () => {
  it("明細・顧客を請求書へコピーし相互参照と converted を記録する", async () => {
    const { store, businessId, actor, quote } = await seedQuote("accepted");
    const { invoice, quote: converted } = await convertQuoteToInvoice(
      store,
      businessId,
      actor,
      quote.id,
      {
        idempotencyKey: "conv-1",
        issueDate: "2025-06-20",
        dueDate: "2025-07-20",
      },
    );
    expect(invoice.status).toBe("draft");
    expect(invoice.invoiceNumber).toBe("INV-000001");
    expect(invoice.customerId).toBe(quote.customerId);
    expect(invoice.items).toEqual(quote.items);
    expect(invoice.totalAmount).toBe(quote.totalAmount);
    expect(invoice.quoteId).toBe(quote.id);
    expect(converted.status).toBe("converted");
    expect(converted.convertedInvoiceId).toBe(invoice.id);

    const savedQuote = await store.getQuote(businessId, quote.id);
    expect(savedQuote?.status).toBe("converted");
    const savedInvoice = await store.getInvoice(businessId, invoice.id);
    expect(savedInvoice?.quoteId).toBe(quote.id);
  });

  it("sent からも転換でき、draft/converted は拒否する", async () => {
    const { store, businessId, actor, quote } = await seedQuote();
    await expect(
      convertQuoteToInvoice(store, businessId, actor, quote.id, {
        idempotencyKey: "conv-draft",
        issueDate: "2025-06-20",
        dueDate: "2025-07-20",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });

    await markQuoteSent(store, businessId, actor, quote.id);
    const converted = await convertQuoteToInvoice(
      store,
      businessId,
      actor,
      quote.id,
      {
        idempotencyKey: "conv-sent",
        issueDate: "2025-06-20",
        dueDate: "2025-07-20",
      },
    );
    expect(converted.quote.status).toBe("converted");
    // converted の再転換は既存請求書を冪等に返す
    const again = await convertQuoteToInvoice(store, businessId, actor, quote.id, {
      idempotencyKey: "conv-again",
      issueDate: "2025-06-21",
      dueDate: "2025-07-21",
    });
    expect(again.invoice.id).toBe(converted.invoice.id);
    expect(await store.listInvoices(businessId)).toHaveLength(1);
  });

  it("冪等リプレイでは採番・転換を重複しない", async () => {
    const { store, businessId, actor, quote } = await seedQuote("accepted");
    const a = await convertQuoteToInvoice(store, businessId, actor, quote.id, {
      idempotencyKey: "conv-dup",
      issueDate: "2025-06-20",
      dueDate: "2025-07-20",
    });
    const b = await convertQuoteToInvoice(store, businessId, actor, quote.id, {
      idempotencyKey: "conv-dup",
      issueDate: "2025-06-20",
      dueDate: "2025-07-20",
    });
    expect(b.replayed).toBe(true);
    expect(b.invoice.id).toBe(a.invoice.id);
    expect(await store.listInvoices(businessId)).toHaveLength(1);
  });

  it("dueDate が issueDate より前・締め済み期間の発行日は拒否する", async () => {
    const { store, businessId, actor, quote } = await seedQuote("accepted");
    await expect(
      convertQuoteToInvoice(store, businessId, actor, quote.id, {
        idempotencyKey: "conv-due",
        issueDate: "2025-07-20",
        dueDate: "2025-06-20",
      }),
    ).rejects.toMatchObject({ code: "DUE_BEFORE_ISSUE" });

    await seedClosedPeriod(store, businessId, {
      id: "fy2025h1",
      fiscalYear: 2025,
      startDate: "2025-01-01",
      endDate: "2025-06-30",
    });
    await expect(
      convertQuoteToInvoice(store, businessId, actor, quote.id, {
        idempotencyKey: "conv-closed",
        issueDate: "2025-06-15",
        dueDate: "2025-07-15",
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("転換で案件も引き継がれる", async () => {
    const env = await setupStore();
    const { store, businessId, actor } = env;
    const { customer } = await registerCustomer(store, businessId, actor, {
      id: "cust-1",
      name: "顧客A",
    });
    const { project } = await registerProject(store, businessId, actor, {
      id: "proj-1",
      customerId: customer.id,
      name: "サイト改修",
    });
    const { quote } = await registerQuote(store, businessId, actor, {
      idempotencyKey: "q-proj",
      customerId: customer.id,
      projectId: project.id,
      issueDate: "2025-06-01",
      validUntil: "2025-06-30",
      items,
    });
    await markQuoteSent(store, businessId, actor, quote.id);
    const { invoice } = await convertQuoteToInvoice(
      store,
      businessId,
      actor,
      quote.id,
      {
        idempotencyKey: "conv-proj",
        issueDate: "2025-06-20",
        dueDate: "2025-07-20",
      },
    );
    expect(invoice.projectId).toBe(project.id);
  });
});
