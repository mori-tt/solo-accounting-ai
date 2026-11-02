import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/accounting/types";
import {
  normalizeSearchText,
  recentDistinctValues,
  transactionMatchesQuery,
} from "./search";

function tx(partial: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    type: "expense",
    date: "2026-10-15",
    amount: 12000,
    account: "supplies",
    counterparty: "Amazon.co.jp",
    description: "コピー用紙の購入",
    receiptIds: [],
    status: "confirmed",
    createdBy: "u1",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...partial,
  };
}

describe("normalizeSearchText", () => {
  it("全角英数を半角化し小文字化する", () => {
    expect(normalizeSearchText("ＡＢＣ１２３")).toBe("abc123");
  });

  it("半角カナを全角カナに寄せる", () => {
    expect(normalizeSearchText("ｱﾏｿﾞﾝ")).toBe("アマゾン");
  });

  it("全角スペースを含む連続空白を畳んでトリムする", () => {
    expect(normalizeSearchText("  Amazon　  12000  ")).toBe("amazon 12000");
  });
});

describe("transactionMatchesQuery", () => {
  const t = tx();

  it("空クエリは全件一致", () => {
    expect(transactionMatchesQuery(t, "")).toBe(true);
    expect(transactionMatchesQuery(t, "   ")).toBe(true);
  });

  it("摘要・取引先・科目コード・科目名を部分一致で横断検索する", () => {
    expect(transactionMatchesQuery(t, "コピー")).toBe(true);
    expect(transactionMatchesQuery(t, "amazon")).toBe(true);
    expect(transactionMatchesQuery(t, "supplies")).toBe(true);
    expect(transactionMatchesQuery(t, "消耗品", "消耗品費")).toBe(true);
  });

  it("科目名は科目ラベルが渡された場合のみ一致する", () => {
    expect(transactionMatchesQuery(t, "消耗品")).toBe(false);
    expect(transactionMatchesQuery(t, "消耗品", "消耗品費")).toBe(true);
  });

  it("金額は数字一致(カンマ・¥・円を含む表記も可)", () => {
    expect(transactionMatchesQuery(t, "12000")).toBe(true);
    expect(transactionMatchesQuery(t, "12,000")).toBe(true);
    expect(transactionMatchesQuery(t, "¥12000")).toBe(true);
    expect(transactionMatchesQuery(t, "12000円")).toBe(true);
    expect(transactionMatchesQuery(t, "１２０００")).toBe(true);
    expect(transactionMatchesQuery(t, "34000")).toBe(false);
  });

  it("全角・半角カナの揺れを吸収する", () => {
    expect(transactionMatchesQuery(t, "Ａｍａｚｏｎ")).toBe(true);
    const kana = tx({ counterparty: "アマゾンジャパン" });
    expect(transactionMatchesQuery(kana, "ｱﾏｿﾞﾝ")).toBe(true);
  });

  it("空白区切りトークンはAND(いずれかの項目に各トークンが一致)", () => {
    expect(transactionMatchesQuery(t, "amazon コピー")).toBe(true);
    expect(transactionMatchesQuery(t, "amazon 12000")).toBe(true);
    expect(transactionMatchesQuery(t, "amazon 9999")).toBe(false);
    expect(transactionMatchesQuery(t, "amazon 楽天")).toBe(false);
  });

  it("どの項目にも一致しないトークンを含む場合は不一致", () => {
    expect(transactionMatchesQuery(t, "楽天")).toBe(false);
    expect(transactionMatchesQuery(t, "コピー 楽天")).toBe(false);
  });
});

describe("recentDistinctValues", () => {
  it("空文字と重複を除き出現順(=直近利用順)で返す", () => {
    expect(
      recentDistinctValues(["B社", "A社", "", "  ", "B社", "C社"]),
    ).toEqual(["B社", "A社", "C社"]);
  });

  it("前後の空白を除去する", () => {
    expect(recentDistinctValues(["  A社  "])).toEqual(["A社"]);
  });

  it("limit で打ち切る", () => {
    expect(recentDistinctValues(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});
