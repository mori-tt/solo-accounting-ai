import { describe, expect, it } from "vitest";
import {
  invoicePaymentProgress,
  invoiceSettlement,
  rankPaymentLinkCandidates,
} from "./payment-matching";

const tx = (id: string, date: string, counterparty: string) => ({
  id,
  date,
  counterparty,
});

describe("rankPaymentLinkCandidates", () => {
  it("同顧客の取引を先頭に、それ以外は日付降順で並べる", () => {
    const ranked = rankPaymentLinkCandidates(
      [
        tx("a", "2025-06-05", "他社"),
        tx("b", "2025-06-10", "顧客A"),
        tx("c", "2025-06-20", "他社"),
        tx("d", "2025-06-01", "顧客A"),
      ],
      "顧客A",
    );
    expect(ranked.map((r) => r.transaction.id)).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
    expect(ranked[0].sameCustomer).toBe(true);
    expect(ranked[2].sameCustomer).toBe(false);
  });

  it("counterparty が空の取引は同顧客扱いしない", () => {
    const ranked = rankPaymentLinkCandidates([tx("a", "2025-06-01", "")], "顧客A");
    expect(ranked[0].sameCustomer).toBe(false);
  });

  it("excludeIds の取引を候補から除く(二重消込防止)", () => {
    const ranked = rankPaymentLinkCandidates(
      [tx("a", "2025-06-01", "顧客A"), tx("b", "2025-06-02", "顧客A")],
      "顧客A",
      new Set(["a"]),
    );
    expect(ranked.map((r) => r.transaction.id)).toEqual(["b"]);
  });
});

describe("invoicePaymentProgress", () => {
  const invoice = (status: "draft" | "issued" | "paid" | "overdue") => ({
    status,
    totalAmount: 100_000,
  });

  it("draft は null(バッジ対象外)", () => {
    expect(invoicePaymentProgress(invoice("draft"), 0)).toBeNull();
  });

  it("入金0なら unpaid、一部なら partial、全額なら paid", () => {
    expect(invoicePaymentProgress(invoice("issued"), 0)).toBe("unpaid");
    expect(invoicePaymentProgress(invoice("overdue"), 0)).toBe("unpaid");
    expect(invoicePaymentProgress(invoice("issued"), 50_000)).toBe("partial");
    expect(invoicePaymentProgress(invoice("paid"), 100_000)).toBe("paid");
    expect(invoicePaymentProgress(invoice("issued"), 100_000)).toBe("paid");
  });
});

describe("invoiceSettlement", () => {
  it("入金が無ければ null", () => {
    expect(invoiceSettlement([])).toBeNull();
  });

  it("全入金が transactionId 付きなら matched", () => {
    expect(
      invoiceSettlement([{ transactionId: "t1" }, { transactionId: "t2" }]),
    ).toBe("matched");
  });

  it("1件でも未紐付けがあれば unmatched", () => {
    expect(invoiceSettlement([{ transactionId: "t1" }, {}])).toBe("unmatched");
    expect(invoiceSettlement([{ transactionId: "" }])).toBe("unmatched");
  });
});
