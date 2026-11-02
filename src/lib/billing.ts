import type { Business, BusinessPlan } from "@/lib/accounting/types";

/**
 * 課金基盤の抽象層。
 *
 * Business.plan(料金プラン)から機能可否(PlanEntitlements)を決定し、
 * UIの表示制御とサーバー側のentitlementチェックを同一ロジックで行う。
 * 決済プロバイダ(Stripe等)との実接続は行わない。課金接続時の変更点は
 * Business.plan の書き換え経路(課金webhook→Admin SDK)の追加と
 * PLAN_ENTITLEMENTS の値の見直しのみで、判定経路は変えない設計。
 *
 * firebase 等への依存を持たない純粋モジュールのため、
 * クライアント/サーバー双方から import できる。
 */

/** Business.plan に設定しうるプラン値の一覧 */
export const BUSINESS_PLANS = [
  "free",
  "pro",
] as const satisfies readonly BusinessPlan[];

/** plan 未設定(課金導入前の既存データ)のときの既定プラン */
export const DEFAULT_BUSINESS_PLAN: BusinessPlan = "free";

export const PLAN_LABELS: Record<BusinessPlan, string> = {
  free: "Free",
  pro: "Pro",
};

/**
 * entitlementチェック対象の機能キー。
 * プランで可否を切り分ける機能をここで一元管理する。
 * 新しい課金対象機能を足す場合はここへ追加し、
 * FEATURE_LABELS・PLAN_ENTITLEMENTS にも行を足す(型で抜けを検知)。
 */
export const BILLING_FEATURES = [
  "ai_suggestions",
  "ai_receipt_ocr",
  "csv_export",
  "backup_restore",
  "member_invite",
  "filing_support",
] as const;

export type BillingFeature = (typeof BILLING_FEATURES)[number];

export const FEATURE_LABELS: Record<BillingFeature, string> = {
  ai_suggestions: "AI提案(科目・摘要・重複検出・月次説明)",
  ai_receipt_ocr: "証憑のOCR読み取り",
  csv_export: "帳簿CSVエクスポート",
  backup_restore: "バックアップと復元",
  member_invite: "メンバー招待",
  filing_support: "締め・確定申告サポート",
};

/** 1プラン分の機能可否マップ。全機能を列挙する必要がある(抜けは型エラー) */
export type PlanEntitlements = Record<BillingFeature, boolean>;

/**
 * プラン×機能の対応表。設定画面の機能比較表示もここから組み立てる。
 * 課金未接続の現段階では全プラン・全機能を有効とする。
 * 料金差別化を始める際はここの値だけを変更する(判定経路の変更は不要)。
 */
export const PLAN_ENTITLEMENTS: Record<BusinessPlan, PlanEntitlements> = {
  free: {
    ai_suggestions: true,
    ai_receipt_ocr: true,
    csv_export: true,
    backup_restore: true,
    member_invite: true,
    filing_support: true,
  },
  pro: {
    ai_suggestions: true,
    ai_receipt_ocr: true,
    csv_export: true,
    backup_restore: true,
    member_invite: true,
    filing_support: true,
  },
};

/**
 * 生データ(Firestoreのbusinessドキュメント等)の plan を検証する。
 * BUSINESS_PLANS 以外(未設定・未知値)は undefined を返す。
 * toMemberRole と同じく、呼び出し側で既定値へ畳み込むこと。
 */
export function toBusinessPlan(value: unknown): BusinessPlan | undefined {
  return (BUSINESS_PLANS as readonly string[]).includes(value as string)
    ? (value as BusinessPlan)
    : undefined;
}

/** plan 未設定(課金導入前の既存データ)・未知値は既定プランへ畳み込む */
export function resolveBusinessPlan(
  plan: string | null | undefined,
): BusinessPlan {
  return toBusinessPlan(plan) ?? DEFAULT_BUSINESS_PLAN;
}

/** Businessドキュメントのプラン。未設定の既存データは free 扱い */
export function businessPlanOf(
  business: Pick<Business, "plan"> | null | undefined,
): BusinessPlan {
  return resolveBusinessPlan(business?.plan);
}

/** プランに対応する機能可否マップを返す */
export function entitlementsFor(
  plan: string | null | undefined,
): PlanEntitlements {
  return PLAN_ENTITLEMENTS[resolveBusinessPlan(plan)];
}

/**
 * 機能がプランで有効か。entitlementチェックは全てこの関数を通す。
 * サーバー側は src/lib/api/entitlements.ts の assertFeatureEntitled 経由。
 */
export function hasEntitlement(
  plan: string | null | undefined,
  feature: BillingFeature,
): boolean {
  return entitlementsFor(plan)[feature];
}
