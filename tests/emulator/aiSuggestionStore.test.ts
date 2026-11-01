import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { FirestoreSuggestionStore } from "../../src/lib/ai/firestore-store";
import type { NewAISuggestion } from "../../src/lib/ai/types";

/**
 * Firestore Emulator 経由のaiSuggestion store実装テスト。
 * `pnpm test:emulators`(firebase emulators:exec)でのみ実行され、
 * FIRESTORE_EMULATOR_HOST 未設定の通常の `pnpm test` ではスキップされる。
 */
const emulator = process.env.FIRESTORE_EMULATOR_HOST !== undefined;
const PROJECT_ID = "demo-solo-accounting-ai";

function makeDoc(
  businessId: string,
  overrides: Partial<NewAISuggestion> = {},
): NewAISuggestion {
  const now = new Date("2026-11-02T00:00:00.000Z");
  return {
    businessId,
    kind: "receipt_extraction",
    target: { type: "receipt", id: "rcpt-1" },
    status: "pending",
    payload: { amount: 1280, date: "2026-10-01", vendor: "商店" },
    confidence: 0.9,
    reason: "OCRから抽出",
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

describe.skipIf(!emulator)("FirestoreSuggestionStore (emulator)", () => {
  let store: FirestoreSuggestionStore;
  const businessId = "biz-ai-emu";

  beforeAll(async () => {
    const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
    store = new FirestoreSuggestionStore(getFirestore(app));
    // Emulatorデータをクリア
    await fetch(
      `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: "DELETE" },
    );
  });

  it("提案ドキュメントを往復できる(Timestamp変換・payload保持)", async () => {
    const id = await store.create(businessId, makeDoc(businessId));
    const saved = await store.get(businessId, id);

    expect(saved?.id).toBe(id);
    expect(saved?.kind).toBe("receipt_extraction");
    expect(saved?.target).toEqual({ type: "receipt", id: "rcpt-1" });
    expect(saved?.payload).toEqual({
      amount: 1280,
      date: "2026-10-01",
      vendor: "商店",
    });
    expect(saved?.createdAt).toBeInstanceOf(Date);
    expect(saved?.decidedAt).toBeNull();
  });

  it("listはtarget.idのwhere+条件絞込み+createdAt降順で返す", async () => {
    await store.create(
      businessId,
      makeDoc(businessId, {
        target: { type: "receipt", id: "rcpt-A" },
        createdAt: new Date("2026-11-01T00:00:00Z"),
      }),
    );
    await store.create(
      businessId,
      makeDoc(businessId, {
        target: { type: "receipt", id: "rcpt-A" },
        createdAt: new Date("2026-11-02T00:00:00Z"),
      }),
    );
    await store.create(
      businessId,
      makeDoc(businessId, {
        target: { type: "receipt", id: "rcpt-B" },
        status: "accepted",
      }),
    );

    const forA = await store.list(businessId, { targetId: "rcpt-A" });
    expect(forA).toHaveLength(2);
    expect(forA.map((s) => s.createdAt.toISOString())).toEqual([
      "2026-11-02T00:00:00.000Z",
      "2026-11-01T00:00:00.000Z",
    ]);

    const pendingOnly = await store.list(businessId, {
      targetId: "rcpt-A",
      status: "pending",
    });
    expect(pendingOnly).toHaveLength(2);
    const acceptedOnly = await store.list(businessId, {
      status: "accepted",
    });
    expect(acceptedOnly).toHaveLength(1);
    expect(acceptedOnly[0].target.id).toBe("rcpt-B");

    const limited = await store.list(businessId, { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("他businessIdの提案を返さない・取得しない", async () => {
    const other = "biz-ai-other";
    const id = await store.create(other, makeDoc(other));

    expect(await store.get(businessId, id)).toBeNull();
    const list = await store.list(businessId);
    expect(list.every((s) => s.businessId !== other)).toBe(true);
  });
});
