import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "./auth-provider";
import { KeyboardShortcuts } from "./keyboard-shortcuts";

const pushMock = vi.fn();
let pathname = "/dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => pathname,
}));

vi.mock("./auth-provider", () => ({ useApp: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  pathname = "/dashboard";
});

function mockApp(status = "signed_in", role: string = "editor") {
  vi.mocked(useApp).mockReturnValue({
    status,
    business: { role },
  } as unknown as ReturnType<typeof useApp>);
}

function pressKey(key: string, target?: Element) {
  fireEvent.keyDown(target ?? document.body, { key });
}

describe("KeyboardShortcuts", () => {
  it("g → d でダッシュボード、g → t で取引一覧へ遷移する", () => {
    mockApp();
    render(<KeyboardShortcuts />);

    pressKey("g");
    pressKey("d");
    expect(pushMock).toHaveBeenCalledWith("/dashboard");

    pressKey("g");
    pressKey("t");
    expect(pushMock).toHaveBeenCalledWith("/transactions");
  });

  it("g の後に対応しないキーを押しても遷移しない", () => {
    mockApp();
    render(<KeyboardShortcuts />);
    pressKey("g");
    pressKey("x");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("n で取引登録フォームを開く(editor以上は ?new=1 付き)", () => {
    mockApp("signed_in", "editor");
    render(<KeyboardShortcuts />);
    pressKey("n");
    expect(pushMock).toHaveBeenCalledWith("/transactions?new=1");
  });

  it("viewerは n でフォーム起動パラメータを付けない", () => {
    mockApp("signed_in", "viewer");
    render(<KeyboardShortcuts />);
    pressKey("n");
    expect(pushMock).toHaveBeenCalledWith("/transactions");
  });

  it("/ で検索画面へ遷移し、検索画面では入力欄にフォーカスする", () => {
    mockApp();
    render(<KeyboardShortcuts />);
    pressKey("/");
    expect(pushMock).toHaveBeenCalledWith("/search");

    // 既に /search にいる場合は遷移せずフォーカスのみ
    pathname = "/search";
    cleanup();
    render(
      <>
        <KeyboardShortcuts />
        <input data-shortcut="search-input" />
      </>,
    );
    const input = document.querySelector("input[data-shortcut]");
    pressKey("/");
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  it("? でショートカット一覧ダイアログを開閉する", () => {
    mockApp();
    render(<KeyboardShortcuts />);
    expect(screen.queryByRole("dialog")).toBeNull();

    pressKey("?");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/ダッシュボードへ移動/)).toBeTruthy();

    // Escape で閉じる
    pressKey("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();

    // ? で再表示・トグルで閉じる
    pressKey("?");
    expect(screen.getByRole("dialog")).toBeTruthy();
    pressKey("?");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("入力欄フォーカス中はショートカットを発動しない", () => {
    mockApp();
    render(
      <>
        <KeyboardShortcuts />
        <input aria-label="text" />
      </>,
    );
    const input = screen.getByLabelText("text");
    pressKey("n", input);
    pressKey("?", input);
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("修飾キー併用や未ログインでは発動しない", () => {
    mockApp();
    render(<KeyboardShortcuts />);
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
    expect(pushMock).not.toHaveBeenCalled();

    cleanup();
    mockApp("signed_out");
    render(<KeyboardShortcuts />);
    pressKey("n");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
