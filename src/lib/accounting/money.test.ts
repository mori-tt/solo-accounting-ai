import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { assertNonNegativeYen, assertYenAmount } from "./money";

describe("assertYenAmount", () => {
  it("正の整数円を受け入れる", () => {
    expect(assertYenAmount(1)).toBe(1);
    expect(assertYenAmount(100_000)).toBe(100_000);
  });

  it("0円を拒否する", () => {
    expect(() => assertYenAmount(0)).toThrowError(DomainError);
    expect(() => assertYenAmount(0)).toThrowError(
      expect.objectContaining({ code: "INVALID_AMOUNT" }),
    );
  });

  it("負の金額を拒否する", () => {
    expect(() => assertYenAmount(-1)).toThrowError(
      expect.objectContaining({ code: "INVALID_AMOUNT" }),
    );
    expect(() => assertYenAmount(-100_000)).toThrowError(DomainError);
  });

  it("小数・非数値を拒否する", () => {
    for (const v of [1.5, 0.1, NaN, "100", null, undefined]) {
      expect(() => assertYenAmount(v)).toThrowError(
        expect.objectContaining({ code: "INVALID_AMOUNT" }),
      );
    }
  });
});

describe("assertNonNegativeYen", () => {
  it("0円を許容する(税額0の経費など)", () => {
    expect(assertNonNegativeYen(0)).toBe(0);
  });

  it("負の金額と小数を拒否する", () => {
    expect(() => assertNonNegativeYen(-10)).toThrowError(
      expect.objectContaining({ code: "INVALID_AMOUNT" }),
    );
    expect(() => assertNonNegativeYen(100.5)).toThrowError(DomainError);
  });
});
