"use server";

import { fiscalPeriodOf } from "@/lib/accounting/dates";
import { allocatedAmount } from "@/lib/accounting/domain/allocation";
import { fiscalYearEndDepreciation } from "@/lib/accounting/domain/depreciation";
import {
  bookCurrentYearDepreciation,
  disposeFixedAsset,
  registerFixedAsset,
  updateFixedAsset,
} from "@/lib/accounting/services/fixedAssets";
import type { FixedAsset } from "@/lib/accounting/types";
import { fail, run, type ActionResult } from "@/lib/api/result";
import { requireEditor, requireViewer } from "@/lib/api/session";
import { getStore } from "@/lib/api/store";
import { todayDateString } from "@/lib/format";
import {
  disposeFixedAssetSchema,
  fixedAssetSchema,
  parseForm,
  type DisposeFixedAssetInput,
  type FixedAssetInput,
} from "@/lib/validation/schemas";

/** 一覧表示用: 資産 + 現在の会計年度末時点の償却状態 */
export interface FixedAssetRow {
  asset: FixedAsset;
  /** 対象の会計年度(開始年) */
  fiscalYear: number;
  /** 当年の保有月数(0-12) */
  months: number;
  /** 当年償却費(円・按分前) */
  annualExpense: number;
  /** 経費計上額(円・事業割合適用後) */
  bookableExpense: number;
  /** 当年末時点の累計償却(円) */
  accumulated: number;
  /** 当年末時点の帳簿価額(円) */
  bookValue: number;
  /** 当年分が計上済みか */
  booked: boolean;
}

export async function listFixedAssetRows(
  businessId: string,
): Promise<ActionResult<FixedAssetRow[]>> {
  return run(async () => {
    await requireViewer(businessId);
    const store = getStore();
    const business = await store.getBusiness(businessId);
    const startMonth = business?.fiscalYearStartMonth ?? 1;
    const { fiscalYear } = fiscalPeriodOf(todayDateString(), startMonth);
    const assets = await store.listFixedAssets(businessId);
    const rows: FixedAssetRow[] = assets.map((asset) => {
      const state = fiscalYearEndDepreciation(asset, startMonth, fiscalYear);
      return {
        asset,
        fiscalYear,
        months: state.months,
        annualExpense: state.expense,
        bookableExpense: allocatedAmount(state.expense, asset.businessRatio),
        accumulated: state.accumulated,
        bookValue: state.bookValue,
        booked:
          asset.lastBookedFiscalYear !== undefined &&
          asset.lastBookedFiscalYear >= fiscalYear,
      };
    });
    rows.sort(
      (a, b) =>
        a.asset.acquiredDate.localeCompare(b.asset.acquiredDate) ||
        a.asset.id.localeCompare(b.asset.id),
    );
    return rows;
  });
}

export async function createFixedAsset(
  businessId: string,
  input: FixedAssetInput & { idempotencyKey: string },
): Promise<ActionResult<FixedAsset>> {
  const parsed = parseForm(fixedAssetSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { asset } = await registerFixedAsset(getStore(), businessId, actor, {
      idempotencyKey: input.idempotencyKey,
      name: parsed.data.name,
      acquiredDate: parsed.data.acquiredDate,
      acquisitionCost: parsed.data.acquisitionCost,
      usefulLifeYears: parsed.data.usefulLifeYears,
      method: parsed.data.method,
      businessRatio: parsed.data.businessRatio,
    });
    return asset;
  });
}

export async function updateFixedAssetAction(
  businessId: string,
  assetId: string,
  input: FixedAssetInput,
): Promise<ActionResult<FixedAsset>> {
  const parsed = parseForm(fixedAssetSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { asset } = await updateFixedAsset(
      getStore(),
      businessId,
      actor,
      assetId,
      {
        name: parsed.data.name,
        acquiredDate: parsed.data.acquiredDate,
        acquisitionCost: parsed.data.acquisitionCost,
        usefulLifeYears: parsed.data.usefulLifeYears,
        method: parsed.data.method,
        businessRatio: parsed.data.businessRatio,
      },
    );
    return asset;
  });
}

export async function disposeFixedAssetAction(
  businessId: string,
  assetId: string,
  input: DisposeFixedAssetInput,
): Promise<ActionResult<FixedAsset>> {
  const parsed = parseForm(disposeFixedAssetSchema, input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.issues.join(" / "));
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { asset } = await disposeFixedAsset(
      getStore(),
      businessId,
      actor,
      assetId,
      parsed.data.disposedDate,
    );
    return asset;
  });
}

/**
 * 当年(today が属する会計年度)の償却費を未計上の資産ごとに
 * expense・depreciation科目の取引(draft)として生成する。
 */
export async function bookDepreciationForCurrentYear(
  businessId: string,
): Promise<ActionResult<{ created: number; fiscalYear: number }>> {
  return run(async () => {
    const actor = await requireEditor(businessId);
    const { transactions, fiscalYear } = await bookCurrentYearDepreciation(
      getStore(),
      businessId,
      actor,
      todayDateString(),
    );
    return { created: transactions.length, fiscalYear };
  });
}
