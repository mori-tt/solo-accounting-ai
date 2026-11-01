import { assertDateString, fiscalPeriodOf } from "../dates";
import { allocatedAmount } from "../domain/allocation";
import { fiscalYearEndDepreciation } from "../domain/depreciation";
import { DomainError } from "../errors";
import { assertYenAmount } from "../money";
import type { AccountingStore, PutOp } from "../store/types";
import type {
  DepreciationMethod,
  FixedAsset,
  Transaction,
} from "../types";
import {
  assertDateInOpenPeriod,
  auditsFor,
  newId,
  nowOf,
  type ActorContext,
} from "./common";

/** 償却費取引に使う勘定科目コード(src/lib/accounts.ts の標準科目) */
export const DEPRECIATION_ACCOUNT = "depreciation";

const DEPRECIATION_METHODS: readonly DepreciationMethod[] = [
  "straightLine",
  "decliningBalance",
];

export interface FixedAssetFields {
  name: string;
  /** 取得日 YYYY-MM-DD */
  acquiredDate: string;
  /** 取得価額(円・整数・正数) */
  acquisitionCost: number;
  /** 耐用年数(年・整数) */
  usefulLifeYears: number;
  method: DepreciationMethod;
  /** 事業使用割合(%・0-100整数) */
  businessRatio: number;
}

function assertAssetFields(input: FixedAssetFields): void {
  if (!input.name) {
    throw new DomainError("INVALID_INPUT", "name is required");
  }
  assertDateString(input.acquiredDate, "acquiredDate");
  assertYenAmount(input.acquisitionCost, "acquisitionCost");
  if (
    !Number.isInteger(input.usefulLifeYears) ||
    input.usefulLifeYears < 1 ||
    input.usefulLifeYears > 100
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "usefulLifeYears must be an integer between 1 and 100",
    );
  }
  if (!DEPRECIATION_METHODS.includes(input.method)) {
    throw new DomainError(
      "INVALID_INPUT",
      `invalid depreciation method: ${String(input.method)}`,
    );
  }
  if (
    !Number.isInteger(input.businessRatio) ||
    input.businessRatio < 0 ||
    input.businessRatio > 100
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "businessRatio must be an integer between 0 and 100",
    );
  }
}

export interface RegisterFixedAssetInput extends FixedAssetFields {
  id?: string;
  /** リトライ安全のため必須。同じキーでの再実行は既存結果を返す */
  idempotencyKey: string;
}

/** 固定資産を active で登録する。 */
export async function registerFixedAsset(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  input: RegisterFixedAssetInput,
): Promise<{ asset: FixedAsset; replayed: boolean }> {
  assertAssetFields(input);
  const id = input.id ?? newId();
  const at = nowOf(actor);
  const asset: FixedAsset = {
    id,
    name: input.name,
    acquiredDate: input.acquiredDate,
    acquisitionCost: input.acquisitionCost,
    usefulLifeYears: input.usefulLifeYears,
    method: input.method,
    businessRatio: input.businessRatio,
    status: "active",
    createdBy: actor.uid,
    createdAt: at,
    updatedAt: at,
  };
  const { value, replayed } = await store.transact(
    businessId,
    { idempotencyKey: input.idempotencyKey },
    async () => ({
      batch: {
        puts: [{ collection: "fixedAssets", id, data: asset }],
        audits: auditsFor(
          businessId,
          [{ collection: "fixedAssets", id }],
          "create",
          actor,
        ),
      },
      value: asset,
    }),
  );
  return { asset: value, replayed };
}

/** 資産内容の更新。status/disposedDate/lastBookedFiscalYear は維持する。 */
export async function updateFixedAsset(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  assetId: string,
  input: FixedAssetFields,
): Promise<{ asset: FixedAsset }> {
  assertAssetFields(input);
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getFixedAsset(businessId, assetId);
    if (!current) {
      throw new DomainError(
        "NOT_FOUND",
        `fixedAsset ${assetId} not found`,
      );
    }
    const next: FixedAsset = {
      ...current,
      name: input.name,
      acquiredDate: input.acquiredDate,
      acquisitionCost: input.acquisitionCost,
      usefulLifeYears: input.usefulLifeYears,
      method: input.method,
      businessRatio: input.businessRatio,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [{ collection: "fixedAssets", id: assetId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "fixedAssets", id: assetId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { asset: value };
}

/**
 * 資産を除却する。除却月までの月割り償却は継続して計算対象になる。
 * 既に除却済みの資産への再実行は冪等に現在値を返す。
 */
export async function disposeFixedAsset(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  assetId: string,
  disposedDate: string,
): Promise<{ asset: FixedAsset }> {
  const date = assertDateString(disposedDate, "disposedDate");
  const { value } = await store.transact(businessId, {}, async (tx) => {
    const current = await tx.getFixedAsset(businessId, assetId);
    if (!current) {
      throw new DomainError(
        "NOT_FOUND",
        `fixedAsset ${assetId} not found`,
      );
    }
    if (current.status === "disposed") {
      return { batch: { puts: [], audits: [] }, value: current };
    }
    if (date < current.acquiredDate) {
      throw new DomainError(
        "INVALID_INPUT",
        "disposedDate must not be before acquiredDate",
      );
    }
    const next: FixedAsset = {
      ...current,
      status: "disposed",
      disposedDate: date,
      updatedAt: nowOf(actor),
    };
    return {
      batch: {
        puts: [{ collection: "fixedAssets", id: assetId, data: next }],
        audits: auditsFor(
          businessId,
          [{ collection: "fixedAssets", id: assetId }],
          "update",
          actor,
        ),
      },
      value: next,
    };
  });
  return { asset: value };
}

/** 生成される償却取引のドキュメントID(資産・年度ごとに決定的=二重計上防止) */
function depreciationTransactionId(
  assetId: string,
  fiscalYear: number,
): string {
  return `depreciation-${assetId}-${fiscalYear}`;
}

/**
 * today が属する会計年度の償却費を、未計上の資産ごとに
 * 取引(type=expense・科目=depreciation・draft)として生成する。
 * 取引日は会計年度末日、金額は年間償却費×事業割合(円・整数・切り捨て)。
 * 締め済み期間への計上は期間チェックで拒否される。
 * lastBookedFiscalYear で計上済みを管理し再実行は冪等。
 */
export async function bookCurrentYearDepreciation(
  store: AccountingStore,
  businessId: string,
  actor: ActorContext,
  today: string,
): Promise<{ transactions: Transaction[]; fiscalYear: number }> {
  const todayDate = assertDateString(today, "today");

  const { value } = await store.transact(businessId, {}, async (tx) => {
    const business = await tx.getBusiness(businessId);
    const fiscalYearStartMonth = business?.fiscalYearStartMonth ?? 1;
    const period = fiscalPeriodOf(todayDate, fiscalYearStartMonth);

    const periods = await tx.listFiscalPeriods(businessId);
    assertDateInOpenPeriod(period.endDate, periods);

    const assets = await tx.listFixedAssets(businessId);
    const at = nowOf(actor);
    const puts: PutOp[] = [];
    const created: Transaction[] = [];
    const bookedAssets: string[] = [];

    for (const asset of assets) {
      const already =
        asset.lastBookedFiscalYear !== undefined &&
        asset.lastBookedFiscalYear >= period.fiscalYear;
      if (already) continue;

      const state = fiscalYearEndDepreciation(
        asset,
        fiscalYearStartMonth,
        period.fiscalYear,
      );
      if (state.months === 0 || state.expense === 0) continue;

      const amount = allocatedAmount(state.expense, asset.businessRatio);
      const transactionId = depreciationTransactionId(
        asset.id,
        period.fiscalYear,
      );
      const existing = await tx.getTransaction(businessId, transactionId);
      if (!existing && amount > 0) {
        const transaction: Transaction = {
          id: transactionId,
          type: "expense",
          date: period.endDate,
          amount,
          account: DEPRECIATION_ACCOUNT,
          counterparty: "",
          description: `減価償却費 ${asset.name}(${period.fiscalYear}年度分${
            asset.businessRatio < 100
              ? `・事業割合${asset.businessRatio}%`
              : ""
          })`,
          receiptIds: [],
          status: "draft",
          createdBy: actor.uid,
          createdAt: at,
          updatedAt: at,
        };
        created.push(transaction);
        puts.push({
          collection: "transactions",
          id: transactionId,
          data: transaction,
        });
      }
      // 取引を生成しなかった場合(既存重複・按分後0円)も計上済みとして進める
      const nextAsset: FixedAsset = {
        ...asset,
        lastBookedFiscalYear: period.fiscalYear,
        updatedAt: at,
      };
      puts.push({
        collection: "fixedAssets",
        id: asset.id,
        data: nextAsset,
      });
      bookedAssets.push(asset.id);
    }

    return {
      batch: {
        puts,
        audits: [
          ...auditsFor(
            businessId,
            created.map((t) => ({
              collection: "transactions",
              id: t.id,
            })),
            "create",
            actor,
          ),
          ...auditsFor(
            businessId,
            bookedAssets.map((id) => ({
              collection: "fixedAssets",
              id,
            })),
            "update",
            actor,
          ),
        ],
      },
      value: { transactions: created, fiscalYear: period.fiscalYear },
    };
  });
  return value;
}
