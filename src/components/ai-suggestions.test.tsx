import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AISuggestionJSON } from "@/lib/ai/types";
import { AISuggestionCard } from "./ai-suggestions";

afterEach(cleanup);

function baseSuggestion(overrides: Partial<AISuggestionJSON>): AISuggestionJSON {
  return {
    id: "sug-1",
    businessId: "biz-1",
    kind: "account_suggestion",
    target: { type: "transaction", id: "tx-1" },
    status: "pending",
    payload: null,
    confidence: 0.6,
    reason: "テスト用の根拠",
    issues: [],
    attempts: 1,
    retriable: true,
    lastError: null,
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    createdBy: "user-1",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AISuggestionCard", () => {
  it("勘定科目提案: 候補ごとの採用ボタンが onApply を科目付きで呼ぶ", () => {
    const onApply = vi.fn();
    render(
      <AISuggestionCard
        suggestion={baseSuggestion({
          payload: {
            candidates: [
              { account: "travel", confidence: 0.6, reason: "交通関連" },
            ],
          },
        })}
        canDecide
        onApply={onApply}
        onDecide={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "「旅費交通費」を採用" }));
    expect(onApply).toHaveBeenCalledWith({ account: "travel" });
  });

  it("摘要提案: 「この摘要を採用」が onApply を説明文付きで呼ぶ", () => {
    const onApply = vi.fn();
    render(
      <AISuggestionCard
        suggestion={baseSuggestion({
          kind: "transaction_description",
          payload: { description: "2026-10-01 商店への1,280円の支払い" },
        })}
        canDecide
        onApply={onApply}
        onDecide={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "この摘要を採用" }),
    );
    expect(onApply).toHaveBeenCalledWith({
      description: "2026-10-01 商店への1,280円の支払い",
    });
  });

  it("重複チェック: 候補の取引をresolveTransactionで解決して表示し、確認/却下が決定を呼ぶ", () => {
    const onDecide = vi.fn();
    render(
      <AISuggestionCard
        suggestion={baseSuggestion({
          kind: "duplicate_detection",
          payload: {
            candidates: [
              {
                transactionId: "tx-dup",
                score: 0.8,
                reason: "金額と日付が一致",
              },
            ],
          },
        })}
        canDecide
        resolveTransaction={(id) =>
          id === "tx-dup"
            ? ({
                id: "tx-dup",
                date: "2026-10-01",
                account: "supplies",
                amount: 1280,
              } as never)
            : undefined
        }
        onDecide={onDecide}
      />,
    );

    expect(
      screen.getByText(/2026-10-01 \/ 消耗品費 \/ ￥1,280/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "確認済みにする" }));
    expect(onDecide).toHaveBeenCalledWith("accepted");
    fireEvent.click(screen.getByRole("button", { name: "却下する" }));
    expect(onDecide).toHaveBeenCalledWith("rejected");
  });

  it("月次説明: 説明文とhighlightsを表示する", () => {
    render(
      <AISuggestionCard
        suggestion={baseSuggestion({
          kind: "monthly_explanation",
          target: { type: "monthlySummary", id: "202611" },
          payload: {
            explanation: "今月の収入は10円、支出は5円です。",
            highlights: ["支出が前月比5円減少"],
          },
        })}
      />,
    );

    expect(
      screen.getByText("今月の収入は10円、支出は5円です。"),
    ).toBeTruthy();
    expect(screen.getByText("支出が前月比5円減少")).toBeTruthy();
  });

  it("生成失敗(needs_review+lastError)は警告を出し、採用ボタンを出さず却下のみ", () => {
    render(
      <AISuggestionCard
        suggestion={baseSuggestion({
          status: "needs_review",
          payload: null,
          lastError: { code: "timeout", message: "timed out" },
        })}
        canDecide
        onApply={vi.fn()}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByText(/提案の生成に失敗しました/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /採用/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "確認済みにする" })).toBeNull();
    expect(screen.getByRole("button", { name: "却下する" })).toBeTruthy();
  });

  it("確定済みの提案はボタンを出さない。canDecide=false でも出さない", () => {
    const { rerender } = render(
      <AISuggestionCard
        suggestion={baseSuggestion({ status: "accepted" })}
        canDecide
        onDecide={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <AISuggestionCard
        suggestion={baseSuggestion({
          kind: "transaction_description",
          payload: { description: "x" },
        })}
        canDecide={false}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
