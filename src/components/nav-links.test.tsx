import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePathname } from "next/navigation";
import { NavLinks } from "./nav-links";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NavLinks", () => {
  it("グループ見出し付きで全ナビ項目を表示する", () => {
    vi.mocked(usePathname).mockReturnValue("/dashboard");
    render(<NavLinks />);

    for (const heading of [
      "記帳",
      "売上・請求",
      "レポート",
      "決算・管理",
    ]) {
      expect(
        screen.getByRole("heading", { name: heading }),
      ).toBeTruthy();
    }
    expect(screen.getAllByRole("link")).toHaveLength(24);
  });

  it("現在のパスに対応するリンクだけをアクティブ表示にする", () => {
    vi.mocked(usePathname).mockReturnValue("/transactions");
    render(<NavLinks />);

    const active = screen.getByRole("link", { name: "取引一覧" });
    expect(active.className).toContain("bg-indigo-50");
    const inactive = screen.getByRole("link", { name: "検索" });
    expect(inactive.className).not.toContain("bg-indigo-50");
  });

  it("リンク先は各画面のパスを指す", () => {
    vi.mocked(usePathname).mockReturnValue("/dashboard");
    render(<NavLinks />);

    expect(
      screen
        .getByRole("link", { name: "月次レポート" })
        .getAttribute("href"),
    ).toBe("/reports/monthly");
    expect(
      screen.getByRole("link", { name: "決算チェック" }).getAttribute("href"),
    ).toBe("/closing");
  });
});
