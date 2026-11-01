import { registerBusiness } from "./services/business";
import type { ActorContext } from "./services/common";
import { MemoryStore } from "./store/memory";
import type { FiscalPeriod } from "./types";

/** テスト用のアクター。時刻固定で決定論的にする。 */
export function testActor(at = "2025-06-15T12:00:00.000Z"): ActorContext {
  return { uid: "tester-uid", at };
}

/**
 * MemoryStore + Business(暦年 or 指定開始月)のセットアップ済み環境。
 */
export async function setupStore(fiscalYearStartMonth = 1): Promise<{
  store: MemoryStore;
  businessId: string;
  actor: ActorContext;
}> {
  const store = new MemoryStore();
  const actor = testActor();
  const businessId = "biz-test";
  await registerBusiness(store, actor, {
    id: businessId,
    name: "テスト事業",
    ownerUid: actor.uid,
    fiscalYearStartMonth,
  });
  return { store, businessId, actor };
}

/** 期間を直接シードする(テスト専用)。 */
export async function seedClosedPeriod(
  store: MemoryStore,
  businessId: string,
  period: Omit<FiscalPeriod, "status">,
): Promise<void> {
  await store.transact(businessId, {}, async () => ({
    batch: {
      puts: [
        {
          collection: "fiscalPeriods",
          id: period.id,
          data: { ...period, status: "closed" },
        },
      ],
      audits: [],
    },
    value: undefined,
  }));
}
