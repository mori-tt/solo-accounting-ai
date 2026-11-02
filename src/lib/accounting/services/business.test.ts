import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { testActor } from "../testing";
import { isInvoiceRegistrationNumber, registerBusiness } from "./business";

describe("isInvoiceRegistrationNumber", () => {
  it("T+13桁の数字のみ許容する", () => {
    expect(isInvoiceRegistrationNumber("T1234567890123")).toBe(true);
    expect(isInvoiceRegistrationNumber("1234567890123")).toBe(false);
    expect(isInvoiceRegistrationNumber("t1234567890123")).toBe(false);
    expect(isInvoiceRegistrationNumber("T123456789012")).toBe(false);
    expect(isInvoiceRegistrationNumber("T12345678901234")).toBe(false);
    expect(isInvoiceRegistrationNumber("")).toBe(false);
  });
});

describe("registerBusiness", () => {
  const actor = testActor();

  it("インボイス登録番号・発行者名・住所を保存できる", async () => {
    const store = new MemoryStore();
    const { business } = await registerBusiness(store, actor, {
      id: "biz-1",
      name: "テスト事業",
      ownerUid: actor.uid,
      invoiceRegistrationNumber: "T1234567890123",
      issuerName: "山田太郎商店",
      issuerAddress: "東京都渋谷区1-2-3",
    });
    expect(business.invoiceRegistrationNumber).toBe("T1234567890123");
    expect(business.issuerName).toBe("山田太郎商店");
    expect(business.issuerAddress).toBe("東京都渋谷区1-2-3");
    const saved = await store.getBusiness("biz-1");
    expect(saved?.invoiceRegistrationNumber).toBe("T1234567890123");
  });

  it("インボイス項目未指定の既存呼び出しはそのまま登録できる(後方互換)", async () => {
    const store = new MemoryStore();
    const { business } = await registerBusiness(store, actor, {
      id: "biz-2",
      name: "テスト事業",
      ownerUid: actor.uid,
    });
    expect(business.invoiceRegistrationNumber).toBeUndefined();
    expect(business.issuerName).toBeUndefined();
    expect(business.issuerAddress).toBeUndefined();
    expect(business.invoiceCounter).toBeUndefined();
  });

  it("形式不正の登録番号を拒否する", async () => {
    const store = new MemoryStore();
    await expect(
      registerBusiness(store, actor, {
        id: "biz-3",
        name: "テスト事業",
        ownerUid: actor.uid,
        invoiceRegistrationNumber: "1234567890123",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      registerBusiness(store, actor, {
        id: "biz-4",
        name: "テスト事業",
        ownerUid: actor.uid,
        invoiceRegistrationNumber: "T123",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
