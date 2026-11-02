import { DomainError } from "../errors";
import { assertNonNegativeYen } from "../money";
import type { AccountingStore } from "../store/types";
import type {
  InventoryCount,
  InventoryCountLine,
  InventoryItem,
} from "../types";
import {
  auditsFor,
  newId,
  nowOf,
  scopedIdempotencyKey,
  type ActorContext,
} from "./common";

/**
 * 棚卸品目マスタと年度別期末棚卸カウントのコマンド。
 * 棚卸高は保存せず明細から都度計算する(domain/inventory.ts)。
 */

export interface InventoryItemFields {
  name: string;
  unit: string;
  /** 標準単価(円・整数・0以上) */
  standardUnitPrice: number;
}

function assertItemFields(input: InventoryItemFields): void {
  if (!input.name) {
    throw new DomainError("INVALID_INPUT", "name is required");
  }
  if (!input.unit) {
    throw new DomainError("INVALID_INPUT", "unit is required");
  }
  assertNonNegativeYen(input.standardUnitPrice, "standardUnitPrice");
}

export interface RegisterInventoryItemInput extends InventoryItemFields {
  id?: string;
  /** リトライ安全のため必須。同じキーでの再実行は既存結果を返す */
  idempotencyKey: string;
}

/** 棚卸品目を登録する。 */
export async function registerInventoryItem(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterInventoryItemInput,
): Promise<{ item: InventoryItem; replayed: boolean }> {
  assertItemFields(input);
  const id = input.id ?? newId();
  const at = nowOf(actor);
  const item: InventoryItem = {
    id,
    name: input.name,
    unit: input.unit,
    standardUnitPrice: input.standardUnitPrice,
    createdBy: actor.uid,
    createdAt: at,
    updatedAt: at,
  };
  const { value, replayed } = await store.transact(
    businessId,
    {
      idempotencyKey: scopedIdempotencyKey(
        "inventoryItem",
        input.idempotencyKey,
      ),
    },
    async () => ({
      batch: {
        puts: [{ collection: "inventoryItems", id, data: item }],
        audits: auditsFor(
          businessId,
          [{ collection: "inventoryItems", id }],
          "create",
          actor,
        ),
      },
      value: item,
    }),
  );
  return { item: value, replayed };
}

/** 品目内容の更新。createdBy/createdAt は維持する。 */
export async function updateInventoryItem(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  itemId: string,
  input: InventoryItemFields,
): Promise<{ item: InventoryItem }> {
  assertItemFields(input);
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getInventoryItem(businessId, itemId);
    if (!current) {
      throw new DomainError(
        "NOT_FOUND",
        `inventoryItem ${itemId} not found`,
      );
    }
    const next: InventoryItem = {
      ...current,
      name: input.name,
      unit: input.unit,
      standardUnitPrice: input.standardUnitPrice,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [{ collection: "inventoryItems", id: itemId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "inventoryItems", id: itemId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { item: value };
}

/**
 * 品目を削除する。棚卸カウントの明細は品目名・単位を
 * スナップショット保持するため、削除しても確定済みカウントは変わらない。
 * 存在しない品目への再実行は冪等にスキップする。
 */
export async function deleteInventoryItem(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  itemId: string,
): Promise<{ deleted: boolean }> {
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getInventoryItem(businessId, itemId);
    if (!current) {
      return { batch: { puts: [], audits: [] }, value: false };
    }
    return {
      batch: {
        puts: [],
        deletes: [{ collection: "inventoryItems" as const, id: itemId }],
        audits: auditsFor(
          businessId,
          [{ collection: "inventoryItems", id: itemId }],
          "delete",
          actor,
        ),
      },
      value: true,
    };
  });
  return { deleted: value };
}

/** 棚卸カウントのドキュメントID(fiscalPeriods と同じ決定的採番) */
export function inventoryCountId(fiscalYear: number): string {
  return `fy${fiscalYear}`;
}

export interface InventoryCountLineInput {
  itemId: string;
  /** 実在庫数量(0以上。単位によっては小数可) */
  quantity: number;
  /** 評価単価(円・整数・0以上)。省略時は品目の標準単価 */
  unitPrice?: number;
}

export interface SaveInventoryCountInput {
  /** 会計年度の開始年 */
  fiscalYear: number;
  lines: InventoryCountLineInput[];
}

function assertQuantity(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new DomainError(
      "INVALID_QUANTITY",
      "quantity must be a non-negative number",
      { value },
    );
  }
  return value;
}

/**
 * 指定会計年度の期末棚卸カウントを保存(upsert)する。
 * 明細の品目名・単位は保存時点の品目マスタからスナップショットする。
 * 締め済み年度のカウントは変更できない(期首・期末棚卸高の根拠を保護)。
 * 全明細削除(数量0の行のみ)を保存すれば実質リセットになる。
 */
export async function saveInventoryCount(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: SaveInventoryCountInput,
): Promise<{ count: InventoryCount }> {
  const { fiscalYear } = input;
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) {
    throw new DomainError(
      "INVALID_INPUT",
      "fiscalYear must be an integer between 1900 and 2200",
    );
  }
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.itemId)) {
      throw new DomainError(
        "INVALID_INPUT",
        `duplicate itemId in lines: ${line.itemId}`,
      );
    }
    seen.add(line.itemId);
  }

  const { value } = await store.transact(businessId, {}, async (tx) => {
    const id = inventoryCountId(fiscalYear);
    // 締め済み年度のカウントは変更不可
    const period = await tx.getFiscalPeriod(businessId, id);
    if (period?.status === "closed") {
      throw new DomainError(
        "PERIOD_CLOSED",
        `fiscal period ${id} is closed`,
        { periodId: id },
      );
    }

    const items = await tx.listInventoryItems(businessId);
    const itemById = new Map(items.map((item) => [item.id, item]));
    const lines: InventoryCountLine[] = input.lines.map((line) => {
      const item = itemById.get(line.itemId);
      if (!item) {
        throw new DomainError(
          "NOT_FOUND",
          `inventoryItem ${line.itemId} not found`,
        );
      }
      const unitPrice = line.unitPrice ?? item.standardUnitPrice;
      assertNonNegativeYen(unitPrice, "unitPrice");
      return {
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        quantity: assertQuantity(line.quantity),
        unitPrice,
      };
    });

    const existing = await tx.getInventoryCount(businessId, id);
    const at = nowOf(actor);
    const count: InventoryCount = {
      id,
      fiscalYear,
      lines,
      createdBy: existing?.createdBy ?? actor.uid,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    return {
      batch: {
        puts: [{ collection: "inventoryCounts", id, data: count }],
        audits: auditsFor(
          businessId,
          [{ collection: "inventoryCounts", id }],
          existing ? "update" : "create",
          actor,
        ),
      },
      value: count,
    };
  });
  return { count: value };
}
