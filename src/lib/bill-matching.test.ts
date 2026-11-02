import { describe, expect, it } from "vitest";
import {
  billPaymentProgress,
  billSettlement,
  rankBillPaymentLinkCandidates,
} from "./bill-matching";

const tx = (id: string, date: string, counterparty: string) => ({
  id,
  date,
  counterparty,
});

describe("rankBillPaymentLinkCandidates", () => {
  it("同じ取引先の支出取引を先頭に、それ以外は日付降順で並べる", () => {
    const ranked = rankBillPaymentLinkCandidates(
      [
        tx("a", "2025-06-05", "他社"),
        tx("b", "2025-06-10", "仕入先A"),
        tx("c", "2025-06-20", "他社"),
        tx("d", "2025-06-01", "仕入先A"),
      ],
      "仕入先A",
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

  it("excludeIds の取引を候補から除く(二重消込防止)", () => {
    const ranked = rankBillPaymentLinkCandidates(
      [tx("a", "2025-06-01", "仕入先A"), tx("b", "2025-06-02", "仕入先A")],
      "仕入先A",
      new Set(["a"]),
    );
    expect(ranked.map((r) => r.transaction.id)).toEqual(["b"]);
  });
});

describe("billPaymentProgress", () => {
  const bill = { totalAmount: 100_000 };

  it("支払0なら unpaid、一部なら partial、全額なら paid", () => {
    expect(billPaymentProgress(bill, 0)).toBe("unpaid");
    expect(billPaymentProgress(bill, 50_000)).toBe("partial");
    expect(billPaymentProgress(bill, 100_000)).toBe("paid");
    expect(billPaymentProgress(bill, 150_000)).toBe("paid");
  });
});

describe("billSettlement", () => {
  it("支払が無ければ null", () => {
    expect(billSettlement([])).toBeNull();
  });

  it("全支払が transactionId 付きなら matched", () => {
    expect(
      billSettlement([{ transactionId: "t1" }, { transactionId: "t2" }]),
    ).toBe("matched");
  });

  it("1件でも未紐付けがあれば unmatched", () => {
    expect(billSettlement([{ transactionId: "t1" }, {}])).toBe("unmatched");
    expect(billSettlement([{ transactionId: "" }])).toBe("unmatched");
  });
});
