import { describe, expect, it } from "vitest";
import {
  costOfGoodsSold,
  inventoryLineAmount,
  inventoryTotalAmount,
} from "./inventory";

describe("inventoryLineAmount", () => {
  it("数量×単価の積を返す", () => {
    expect(inventoryLineAmount(3, 1000)).toBe(3000);
    expect(inventoryLineAmount(0, 1000)).toBe(0);
  });

  it("小数数量は四捨五入で円に丸める", () => {
    expect(inventoryLineAmount(2.5, 100)).toBe(250);
    // 浮動誤差(0.29*100=28.999...)が切り捨てで欠けないこと
    expect(inventoryLineAmount(0.29, 100)).toBe(29);
    expect(inventoryLineAmount(1.005, 1000)).toBe(1005);
  });
});

describe("inventoryTotalAmount", () => {
  it("明細合計を返す", () => {
    expect(
      inventoryTotalAmount([
        { quantity: 2, unitPrice: 500 },
        { quantity: 1, unitPrice: 300 },
        { quantity: 0, unitPrice: 999 },
      ]),
    ).toBe(1300);
  });

  it("明細なしは0", () => {
    expect(inventoryTotalAmount([])).toBe(0);
  });
});

describe("costOfGoodsSold", () => {
  it("期首 + 仕入 - 期末", () => {
    expect(costOfGoodsSold(100_000, 500_000, 80_000)).toBe(520_000);
  });

  it("棚卸なしなら仕入高と一致する", () => {
    expect(costOfGoodsSold(0, 500_000, 0)).toBe(500_000);
  });
});
