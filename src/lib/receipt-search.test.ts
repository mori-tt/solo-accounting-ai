import { describe, expect, it } from "vitest";
import type { Receipt, Transaction } from "@/lib/accounting/types";
import { filterReceipts, receiptMatchesFilter } from "./receipt-search";

const receiptFixture = (extra: Partial<Receipt> = {}): Receipt => ({
  id: "r1",
  storagePath: "receipts/b1/r1/receipt-1015.pdf",
  fileName: "receipt-1015.pdf",
  mimeType: "application/pdf",
  status: "unprocessed",
  createdBy: "u1",
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
  ...extra,
});

const txFixture = (extra: Partial<Transaction> = {}): Transaction => ({
  id: "t1",
  type: "expense",
  date: "2026-10-15",
  amount: 12000,
  account: "supplies",
  counterparty: "テスト商店",
  description: "備品購入",
  receiptIds: [],
  status: "confirmed",
  createdBy: "u1",
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
  ...extra,
});

describe("receiptMatchesFilter キーワード", () => {
  const r = receiptFixture({ counterparty: "〇〇商店" });
  const t = txFixture();

  it("空条件は全件一致", () => {
    expect(receiptMatchesFilter(r, t, {})).toBe(true);
    expect(receiptMatchesFilter(r, t, { query: "  " })).toBe(true);
  });

  it("ファイル名・証憑の取引先・紐付取引の取引先/摘要の部分一致", () => {
    expect(receiptMatchesFilter(r, t, { query: "1015" })).toBe(true);
    expect(receiptMatchesFilter(r, t, { query: "〇〇" })).toBe(true);
    expect(receiptMatchesFilter(r, t, { query: "テスト" })).toBe(true);
    expect(receiptMatchesFilter(r, t, { query: "備品" })).toBe(true);
    expect(receiptMatchesFilter(r, t, { query: "存在しない" })).toBe(false);
  });

  it("数字トークンは証憑・取引の金額へ部分一致する", () => {
    expect(receiptMatchesFilter(r, t, { query: "12000" })).toBe(true);
    expect(receiptMatchesFilter(r, t, { query: "12,000" })).toBe(true);
    expect(receiptMatchesFilter(r, t, { query: "999" })).toBe(false);
    const metaOnly = receiptFixture({ amount: 3400 });
    expect(receiptMatchesFilter(metaOnly, undefined, { query: "3400" })).toBe(
      true,
    );
  });

  it("複数トークンはAND。全角英数は半角へ正規化される", () => {
    expect(
      receiptMatchesFilter(r, t, { query: "１２０００ テスト" }),
    ).toBe(true);
    expect(
      receiptMatchesFilter(r, t, { query: "12000 存在しない" }),
    ).toBe(false);
  });
});

describe("receiptMatchesFilter 取引日範囲", () => {
  it("証憑メタデータの日付で絞り込める(両端含む)", () => {
    const r = receiptFixture({ transactionDate: "2026-10-15" });
    expect(
      receiptMatchesFilter(r, undefined, { startDate: "2026-10-15" }),
    ).toBe(true);
    expect(
      receiptMatchesFilter(r, undefined, { endDate: "2026-10-15" }),
    ).toBe(true);
    expect(
      receiptMatchesFilter(r, undefined, {
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      }),
    ).toBe(true);
    expect(
      receiptMatchesFilter(r, undefined, { startDate: "2026-10-16" }),
    ).toBe(false);
    expect(
      receiptMatchesFilter(r, undefined, { endDate: "2026-10-14" }),
    ).toBe(false);
  });

  it("メタデータがなくても紐付取引の日付で絞り込める", () => {
    const r = receiptFixture({ status: "linked", transactionId: "t1" });
    expect(
      receiptMatchesFilter(r, txFixture(), {
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      }),
    ).toBe(true);
    expect(
      receiptMatchesFilter(r, txFixture(), { startDate: "2026-11-01" }),
    ).toBe(false);
  });

  it("メタデータと取引日が異なる場合どちらかが範囲内なら一致する", () => {
    // 紐付後に取引が編集されても証憑側の値で辿れる
    const r = receiptFixture({
      status: "linked",
      transactionId: "t1",
      transactionDate: "2026-10-15",
    });
    const t = txFixture({ date: "2026-11-05" });
    expect(
      receiptMatchesFilter(r, t, { endDate: "2026-10-31" }),
    ).toBe(true);
    expect(
      receiptMatchesFilter(r, t, { startDate: "2026-11-01" }),
    ).toBe(true);
    expect(
      receiptMatchesFilter(r, t, {
        startDate: "2026-12-01",
      }),
    ).toBe(false);
  });

  it("日付情報を持たない証憑は日付範囲指定時に除外される", () => {
    const r = receiptFixture();
    expect(
      receiptMatchesFilter(r, undefined, { startDate: "2026-01-01" }),
    ).toBe(false);
    expect(receiptMatchesFilter(r, undefined, {})).toBe(true);
  });
});

describe("filterReceipts", () => {
  it("紐付取引を txById から解決して絞り込む", () => {
    const linked = receiptFixture({
      id: "r-linked",
      status: "linked",
      transactionId: "t1",
    });
    const lonely = receiptFixture({ id: "r-lonely" });
    const txById = new Map([["t1", txFixture()]]);

    expect(
      filterReceipts([linked, lonely], txById, { query: "テスト商店" }).map(
        (r) => r.id,
      ),
    ).toEqual(["r-linked"]);
    expect(
      filterReceipts([linked, lonely], txById, {
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      }).map((r) => r.id),
    ).toEqual(["r-linked"]);
    expect(filterReceipts([linked, lonely], txById, {})).toHaveLength(2);
  });
});
