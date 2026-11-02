"use server";

import { inventoryTotalAmount } from "@/lib/accounting/domain/inventory";
import {
  deleteInventoryItem,
  inventoryCountId,
  registerInventoryItem,
  saveInventoryCount,
  updateInventoryItem,
} from "@/lib/accounting/services/inventory";
import type {
  InventoryCount,
  InventoryItem,
} from "@/lib/accounting/types";
import {
  actionReadRateLimiter,
  actionWriteRateLimiter,
} from "@/lib/api/rate-limit";
import { fail, run, type ActionResult } from "@/lib/api/result";
import {
  requireEditor,
  requireOwner,
  requireViewer,
} from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import {
  inventoryCountSchema,
  inventoryItemSchema,
  parseForm,
  type InventoryCountInput,
  type InventoryItemInput,
} from "@/lib/validation/schemas";

/**
 * 棚卸(品目マスタ・期末棚卸カウント)の Server Actions。
 * 期末棚卸高は明細(数量×評価単価)の合計として都度返す(集計値は保存しない)。
 */

export interface InventoryYearData {
  /** 品目マスタ全件(品目名順) */
  items: InventoryItem[];
  /** 選択年度の棚卸カウント(未入力は null) */
  count: InventoryCount | null;
  /** 期末棚卸高(円・整数) */
  totalAmount: number;
  /** 選択年度の会計期間が締め済みか(締め済みは変更不可) */
  closed: boolean;
}

/** 品目一覧 + 選択年度の棚卸カウント。/inventory 画面の初期表示用。 */
export async function listInventoryYearData(
  businessId: string,
  fiscalYear: number,
): Promise<ActionResult<InventoryYearData>> {
  if (
    !Number.isInteger(fiscalYear) ||
    fiscalYear < 1900 ||
    fiscalYear > 2200
  ) {
    return fail("INVALID_INPUT", "年度が不正です");
  }
  return run(async () => {
    const actor = await requireViewer(businessId);
    actionReadRateLimiter.consume(actor.uid);
    const store = getStore();
    const yearId = inventoryCountId(fiscalYear);
    const [items, count, period] = await Promise.all([
      store.listInventoryItems(businessId),
      store.getInventoryCount(businessId, yearId),
      store.getFiscalPeriod(businessId, yearId),
    ]);
    items.sort(
      (a, b) => a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id),
    );
    return {
      items,
      count: count ?? null,
      totalAmount: inventoryTotalAmount(count?.lines ?? []),
      closed: period?.status === "closed",
    };
  });
}

export async function createInventoryItem(
  businessId: string,
  input: InventoryItemInput & { idempotencyKey: string },
): Promise<ActionResult<InventoryItem>> {
  const parsed = parseForm(inventoryItemSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { item } = await registerInventoryItem(
      getStore(),
      businessId,
      actor,
      { idempotencyKey: input.idempotencyKey, ...parsed.data },
    );
    return item;
  });
}

export async function updateInventoryItemAction(
  businessId: string,
  itemId: string,
  input: InventoryItemInput,
): Promise<ActionResult<InventoryItem>> {
  const parsed = parseForm(inventoryItemSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { item } = await updateInventoryItem(
      getStore(),
      businessId,
      actor,
      itemId,
      parsed.data,
    );
    return item;
  });
}

/** 品目の削除はownerのみ(firestore.rules と同じ制限) */
export async function deleteInventoryItemAction(
  businessId: string,
  itemId: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  return run(async () => {
    const actor = await requireOwner(businessId);
    actionWriteRateLimiter.consume(businessId);
    return deleteInventoryItem(getStore(), businessId, actor, itemId);
  });
}

/**
 * 選択年度の期末棚卸カウントを保存(upsert)する。
 * 返り値の totalAmount が期末商品棚卸高(決算書の初期値)になる。
 */
export async function saveInventoryCountAction(
  businessId: string,
  input: InventoryCountInput,
): Promise<ActionResult<{ totalAmount: number }>> {
  const parsed = parseForm(inventoryCountSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    actionWriteRateLimiter.consume(businessId);
    const { count } = await saveInventoryCount(
      getStore(),
      businessId,
      actor,
      parsed.data,
    );
    return { totalAmount: inventoryTotalAmount(count.lines) };
  });
}
