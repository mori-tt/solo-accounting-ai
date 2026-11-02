import {
  FEATURE_LABELS,
  hasEntitlement,
  type BillingFeature,
} from "@/lib/billing";
import { ApiError } from "./result";
import { getStore } from "./store";

/**
 * businessId のプランで feature が有効か検証する(entitlementチェック)。
 * 無効なら FORBIDDEN を投げる。requireViewer/requireEditor で認可した後に呼ぶ。
 *
 * クライアント側の表示制御(hasEntitlement)はUX用であり、実効ゲートは
 * 必ずサーバー側のこの関数で行う。現行プラン体系では全機能有効のため
 * 現状は常に通過するが、課金接続後はこの経路が課金可否の正本となる。
 */
export async function assertFeatureEntitled(
  businessId: string,
  feature: BillingFeature,
): Promise<void> {
  const business = await getStore().getBusiness(businessId);
  if (!business) {
    throw new ApiError("NOT_FOUND", "事業が見つかりません");
  }
  if (!hasEntitlement(business.plan, feature)) {
    throw new ApiError(
      "FORBIDDEN",
      `${FEATURE_LABELS[feature]}は現在のプランでは利用できません`,
    );
  }
}
