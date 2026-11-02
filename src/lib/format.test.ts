import { describe, expect, it } from "vitest";
import {
  dateToMonthKey,
  parseMonthKeyParam,
  transactionDeepLink,
} from "./format";

describe("parseMonthKeyParam", () => {
  it("有効な YYYYMM をそのまま返す", () => {
    expect(parseMonthKeyParam("202601")).toBe("202601");
    expect(parseMonthKeyParam("202612")).toBe("202612");
  });

  it("null・空文字・桁数違いは undefined", () => {
    expect(parseMonthKeyParam(null)).toBeUndefined();
    expect(parseMonthKeyParam("")).toBeUndefined();
    expect(parseMonthKeyParam("20261")).toBeUndefined();
    expect(parseMonthKeyParam("2026011")).toBeUndefined();
    expect(parseMonthKeyParam("2026-01")).toBeUndefined();
  });

  it("月が 01-12 の範囲外は undefined", () => {
    expect(parseMonthKeyParam("202600")).toBeUndefined();
    expect(parseMonthKeyParam("202613")).toBeUndefined();
  });

  it("数値でない文字列は undefined", () => {
    expect(parseMonthKeyParam("abcdef")).toBeUndefined();
    expect(parseMonthKeyParam("2026aa")).toBeUndefined();
  });
});

describe("transactionDeepLink", () => {
  it("取引の日付月とIDから /transactions へのリンクを組み立てる", () => {
    expect(transactionDeepLink({ id: "abc123", date: "2026-03-05" })).toBe(
      "/transactions?month=202603&focus=abc123",
    );
  });

  it("IDに予約文字を含んでもエンコードされる", () => {
    expect(transactionDeepLink({ id: "a?b&c", date: "2026-12-31" })).toBe(
      "/transactions?month=202612&focus=a%3Fb%26c",
    );
  });
});

describe("dateToMonthKey", () => {
  it("YYYY-MM-DD を YYYYMM へ変換する", () => {
    expect(dateToMonthKey("2026-01-15")).toBe("202601");
    expect(dateToMonthKey("2026-12-01")).toBe("202612");
  });
});
