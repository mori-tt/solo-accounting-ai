import type { InventoryCountLine } from "../types";

/**
 * 棚卸(期末商品棚卸高)の計算ドメイン。
 * 期末棚卸高は inventoryCounts の明細(数量×評価単価)から都度計算し、
 * 計算値をドキュメントへは保存しない(depreciation と同じ方針)。
 */

/**
 * 明細行の金額 = 数量 × 評価単価(円・整数)。
 * 数量は小数を許容するため四捨五入で円に丸める
 * (切り捨てだと小数数量の浮動誤差で1円未満に欠けることがある)。
 */
export function inventoryLineAmount(
  quantity: number,
  unitPrice: number,
): number {
  return Math.round(quantity * unitPrice);
}

/** 期末棚卸高 = 全明細の金額合計(円・整数) */
export function inventoryTotalAmount(
  lines: readonly Pick<InventoryCountLine, "quantity" | "unitPrice">[],
): number {
  return lines.reduce(
    (sum, line) => sum + inventoryLineAmount(line.quantity, line.unitPrice),
    0,
  );
}

/**
 * 売上原価(差引原価) = 期首商品棚卸高 + 当期仕入高 - 期末商品棚卸高。
 * 収支内訳書の売上原価部の算式(期首 + 仕入 - 期末)。
 */
export function costOfGoodsSold(
  beginningInventory: number,
  purchases: number,
  endingInventory: number,
): number {
  return beginningInventory + purchases - endingInventory;
}
