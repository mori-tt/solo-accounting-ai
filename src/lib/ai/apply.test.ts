import { describe, expect, it } from "vitest";
import { transactionPatchFromSuggestion } from "./apply";
import type { AISuggestion } from "./types";

function makeDoc(overrides: Partial<AISuggestion> = {}): AISuggestion {
  const now = new Date("2026-11-02T00:00:00.000Z");
  return {
    id: "s1",
    businessId: "biz-1",
    kind: "account_suggestion",
    target: { type: "transaction", id: "t1" },
    status: "pending",
    payload: {
      candidates: [
        { account: "502", confidence: 0.8, reason: "消耗品" },
        { account: "508", confidence: 0.3, reason: "雑費" },
      ],
    },
    confidence: 0.8,
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

describe("transactionPatchFromSuggestion", () => {
  it("科目提案は先頭候補をpatchにする", () => {
    expect(transactionPatchFromSuggestion(makeDoc())).toEqual({
      account: "502",
    });
  });

  it("摘要提案はdescription patchを返す", () => {
    const doc = makeDoc({
      kind: "transaction_description",
      payload: { description: "会議用資料購入" },
    });
    expect(transactionPatchFromSuggestion(doc)).toEqual({
      description: "会議用資料購入",
    });
  });

  it("対応しないkind・payload欠落・候補なしはnull", () => {
    expect(
      transactionPatchFromSuggestion(
        makeDoc({ kind: "receipt_extraction", payload: null }),
      ),
    ).toBeNull();
    expect(
      transactionPatchFromSuggestion(
        makeDoc({ kind: "account_suggestion", payload: null }),
      ),
    ).toBeNull();
    expect(
      transactionPatchFromSuggestion(
        makeDoc({ payload: { candidates: [] } }),
      ),
    ).toBeNull();
  });
});
