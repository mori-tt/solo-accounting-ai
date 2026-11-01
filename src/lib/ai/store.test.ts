import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIST_LIMIT,
  InMemorySuggestionStore,
  MAX_LIST_LIMIT,
} from "./store";
import type { NewAISuggestion } from "./types";

function makeDoc(overrides: Partial<NewAISuggestion> = {}): NewAISuggestion {
  const now = new Date("2026-11-02T00:00:00.000Z");
  return {
    businessId: "biz-1",
    kind: "receipt_extraction",
    target: { type: "receipt", id: "rcpt-1" },
    status: "pending",
    payload: null,
    confidence: 0.5,
    reason: "r",
    issues: [],
    attempts: 1,
    retriable: true,
    lastError: null,
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function seed(
  store: InMemorySuggestionStore,
  docs: NewAISuggestion[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const d of docs) ids.push(await store.create(d.businessId, d));
  return ids;
}

describe("InMemorySuggestionStore.list", () => {
  it("createdAt降順で返す", async () => {
    const store = new InMemorySuggestionStore();
    await seed(store, [
      makeDoc({ createdAt: new Date("2026-11-01T00:00:00Z") }),
      makeDoc({ createdAt: new Date("2026-11-02T00:00:00Z") }),
      makeDoc({ createdAt: new Date("2026-10-31T00:00:00Z") }),
    ]);

    const list = await store.list("biz-1");
    expect(list.map((s) => s.createdAt.toISOString())).toEqual([
      "2026-11-02T00:00:00.000Z",
      "2026-11-01T00:00:00.000Z",
      "2026-10-31T00:00:00.000Z",
    ]);
  });

  it("targetType/targetId/kind/statusで絞り込める", async () => {
    const store = new InMemorySuggestionStore();
    await seed(store, [
      makeDoc({ target: { type: "receipt", id: "r1" } }),
      makeDoc({ target: { type: "receipt", id: "r2" } }),
      makeDoc({
        kind: "account_suggestion",
        target: { type: "transaction", id: "tx-1" },
        status: "accepted",
      }),
    ]);

    expect(
      (await store.list("biz-1", { targetType: "receipt" })).length,
    ).toBe(2);
    const byId = await store.list("biz-1", { targetId: "r2" });
    expect(byId).toHaveLength(1);
    expect(byId[0].target.id).toBe("r2");

    const byKind = await store.list("biz-1", {
      kind: "account_suggestion",
    });
    expect(byKind).toHaveLength(1);
    expect(byKind[0].kind).toBe("account_suggestion");

    const byStatus = await store.list("biz-1", { status: "accepted" });
    expect(byStatus).toHaveLength(1);

    const combined = await store.list("biz-1", {
      targetType: "receipt",
      status: "pending",
      kind: "receipt_extraction",
    });
    expect(combined).toHaveLength(2);
  });

  it("他businessIdの提案を返さない", async () => {
    const store = new InMemorySuggestionStore();
    await seed(store, [
      makeDoc(),
      makeDoc({ businessId: "biz-2", target: { type: "receipt", id: "r9" } }),
    ]);

    const list = await store.list("biz-2");
    expect(list).toHaveLength(1);
    expect(list[0].businessId).toBe("biz-2");
  });

  it("limitを適用し、上限を超える指定はMAX_LIST_LIMITに丸める", async () => {
    const store = new InMemorySuggestionStore();
    await seed(
      store,
      Array.from({ length: MAX_LIST_LIMIT + 20 }, () => makeDoc()),
    );

    expect((await store.list("biz-1", { limit: 3 })).length).toBe(3);
    // limit未指定は既定件数、上限超過はMAX_LIST_LIMITに丸める
    expect((await store.list("biz-1")).length).toBe(DEFAULT_LIST_LIMIT);
    expect(
      (await store.list("biz-1", { limit: MAX_LIST_LIMIT + 50 })).length,
    ).toBe(MAX_LIST_LIMIT);
  });
});
