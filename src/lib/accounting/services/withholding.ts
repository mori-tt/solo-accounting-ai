import {
  computeWithholdingTax,
  isWithholdingCategory,
} from "../domain/withholding";
import { DomainError } from "../errors";
import { assertNonNegativeYen, assertYenAmount } from "../money";
import type {
  Transaction,
  WithholdingCalculation,
  WithholdingCategory,
  WithholdingRecord,
} from "../types";
import type { ActorContext } from "./common";

/** 源泉徴収記録の登録・更新入力(zodスキーマと同じ構造) */
export interface WithholdingInput {
  /** 支払区分 */
  category: WithholdingCategory;
  /** 源泉徴収の対象となる支払金額(円・整数・正数)。取引額以下 */
  paymentAmount: number;
  /** 税額の求め方 */
  calculation: WithholdingCalculation;
  /** manual時の源泉徴収税額(円・整数・0以上)。auto時は無視 */
  taxAmount?: number;
  /** 支払調書の細目欄に使うメモ */
  note?: string;
}

/**
 * 入力から源泉徴収税額を確定する。
 * auto は区分の税率で自動計算(salaryは自動計算不可)、manual は入力値。
 */
export function resolveWithholdingTaxAmount(input: WithholdingInput): number {
  assertYenAmount(input.paymentAmount, "paymentAmount");
  if (!isWithholdingCategory(input.category)) {
    throw new DomainError(
      "INVALID_INPUT",
      `invalid withholding category: ${String(input.category)}`,
    );
  }
  if (input.calculation === "auto") {
    return computeWithholdingTax(input.paymentAmount, input.category);
  }
  if (input.calculation !== "manual") {
    throw new DomainError(
      "INVALID_INPUT",
      `invalid withholding calculation: ${String(input.calculation)}`,
    );
  }
  if (input.taxAmount === undefined) {
    throw new DomainError(
      "INVALID_INPUT",
      "taxAmount is required when calculation is manual",
    );
  }
  assertNonNegativeYen(input.taxAmount, "taxAmount");
  if (input.taxAmount > input.paymentAmount) {
    throw new DomainError(
      "INVALID_INPUT",
      "taxAmount must not exceed paymentAmount",
    );
  }
  return input.taxAmount;
}

/**
 * 取引と源泉徴収入力の整合を検証し、保存用のレコードを組み立てる。
 * - 対象は expense 型取引のみ(支払いに対する源泉徴収のため)
 * - 対象支払額は取引額以下(取引額は支払総額のため)
 * - 税額は取引額以下(仕訳で現金貸方が負にならないため)
 * 既存レコードがある場合は createdBy/createdAt を引き継ぐ。
 */
export function planWithholdingRecord(
  transaction: Pick<Transaction, "id" | "type" | "amount">,
  input: WithholdingInput,
  actor: ActorContext,
  at: string,
  existing?: WithholdingRecord,
): WithholdingRecord {
  if (transaction.type !== "expense") {
    throw new DomainError(
      "INVALID_INPUT",
      "withholding applies only to expense transactions",
    );
  }
  const taxAmount = resolveWithholdingTaxAmount(input);
  if (input.paymentAmount > transaction.amount) {
    throw new DomainError(
      "INVALID_INPUT",
      "paymentAmount must not exceed the transaction amount",
    );
  }
  if (taxAmount > transaction.amount) {
    throw new DomainError(
      "INVALID_INPUT",
      "taxAmount must not exceed the transaction amount",
    );
  }
  const note = input.note?.trim();
  return {
    id: transaction.id,
    transactionId: transaction.id,
    category: input.category,
    paymentAmount: input.paymentAmount,
    taxAmount,
    calculation: input.calculation,
    ...(note ? { note } : {}),
    createdBy: existing?.createdBy ?? actor.uid,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
}
