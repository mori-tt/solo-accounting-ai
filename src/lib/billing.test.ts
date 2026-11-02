import { describe, expect, it } from "vitest";
import {
  BILLING_FEATURES,
  businessPlanOf,
  entitlementsFor,
  FEATURE_LABELS,
  hasEntitlement,
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  resolveBusinessPlan,
  toBusinessPlan,
  BUSINESS_PLANS,
} from "./billing";

describe("toBusinessPlan", () => {
  it("有効なプランはそのまま返す", () => {
    expect(toBusinessPlan("free")).toBe("free");
    expect(toBusinessPlan("pro")).toBe("pro");
  });

  it("未知の値は undefined を返す", () => {
    expect(toBusinessPlan("team")).toBeUndefined();
    expect(toBusinessPlan("Pro")).toBeUndefined();
    expect(toBusinessPlan("")).toBeUndefined();
    expect(toBusinessPlan(undefined)).toBeUndefined();
    expect(toBusinessPlan(null)).toBeUndefined();
    expect(toBusinessPlan(1)).toBeUndefined();
  });
});

describe("resolveBusinessPlan", () => {
  it("未設定・未知値は free へ畳み込む", () => {
    // 課金導入前の既存データは plan を持たない(後方互換の既定値)
    expect(resolveBusinessPlan(undefined)).toBe("free");
    expect(resolveBusinessPlan(null)).toBe("free");
    expect(resolveBusinessPlan("team")).toBe("free");
    expect(resolveBusinessPlan("pro")).toBe("pro");
  });
});

describe("businessPlanOf", () => {
  it("businessが無い・plan未設定は free", () => {
    expect(businessPlanOf(undefined)).toBe("free");
    expect(businessPlanOf(null)).toBe("free");
    expect(businessPlanOf({})).toBe("free");
    expect(businessPlanOf({ plan: "pro" })).toBe("pro");
  });
});

describe("entitlementsFor / hasEntitlement", () => {
  it("全プランの全機能が有効(課金未接続の現行仕様)", () => {
    // 料金差別化を始めたらこのテストを実プラン構成に合わせて更新する
    for (const plan of BUSINESS_PLANS) {
      for (const feature of BILLING_FEATURES) {
        expect(hasEntitlement(plan, feature)).toBe(true);
      }
    }
  });

  it("未定義のプランは既定プランのentitlementsを返す", () => {
    expect(entitlementsFor(undefined)).toEqual(PLAN_ENTITLEMENTS.free);
    expect(entitlementsFor("team")).toEqual(PLAN_ENTITLEMENTS.free);
  });

  it("プラン・機能の表示ラベルは全網羅される", () => {
    // 設定画面の機能比較表はラベルから組み立てるため欠落は表示崩れになる
    for (const plan of BUSINESS_PLANS) {
      expect(PLAN_LABELS[plan]).toBeTruthy();
    }
    for (const feature of BILLING_FEATURES) {
      expect(FEATURE_LABELS[feature]).toBeTruthy();
    }
  });
});
