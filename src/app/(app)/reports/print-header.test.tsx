import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrintHeader } from "./print-header";

afterEach(cleanup);

describe("PrintHeader", () => {
  it("帳票名・対象期間・事業名・印刷日を出力する", () => {
    render(
      <PrintHeader
        title="仕訳帳"
        period="2026年11月"
        businessName="山田商店"
      />,
    );

    expect(screen.getByText("仕訳帳")).toBeTruthy();
    expect(screen.getByText("対象期間 2026年11月")).toBeTruthy();
    expect(screen.getByText("山田商店")).toBeTruthy();
    expect(
      screen.getByText(/^印刷日 \d{4}年\d{1,2}月\d{1,2}日$/),
    ).toBeTruthy();
  });

  it("画面では非表示・印刷のみ表示のクラスを持つ", () => {
    const { container } = render(
      <PrintHeader title="試算表" period="2026年11月" />,
    );

    const root = container.firstElementChild;
    expect(root?.classList.contains("hidden")).toBe(true);
    expect(root?.classList.contains("print-only")).toBe(true);
    expect(root?.classList.contains("print-header")).toBe(true);
  });
});
