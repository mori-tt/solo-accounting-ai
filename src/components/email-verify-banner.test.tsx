import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmailVerification, type User } from "firebase/auth";
import { useApp } from "./auth-provider";
import { EmailVerifyBanner } from "./email-verify-banner";

vi.mock("./auth-provider", () => ({ useApp: vi.fn() }));

vi.mock("firebase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/auth")>();
  return { ...actual, sendEmailVerification: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    email: "user@example.com",
    emailVerified: false,
    reload: vi.fn().mockResolvedValue(undefined),
    getIdToken: vi.fn().mockResolvedValue("token"),
    ...overrides,
  } as unknown as User;
}

function mockApp(user: User | null, status = "signed_in") {
  vi.mocked(useApp).mockReturnValue({
    user,
    status,
  } as unknown as ReturnType<typeof useApp>);
}

describe("EmailVerifyBanner", () => {
  it("未ログイン・確認済みでは表示しない", () => {
    mockApp(null, "signed_out");
    const { container, rerender } = render(<EmailVerifyBanner />);
    expect(container.firstChild).toBeNull();

    mockApp(fakeUser({ emailVerified: true }));
    rerender(<EmailVerifyBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("未確認ユーザーにバナーを表示する", () => {
    mockApp(fakeUser());
    render(<EmailVerifyBanner />);
    expect(screen.getByText(/メールアドレスが未確認です/)).toBeTruthy();
  });

  it("再送ボタンで sendEmailVerification を呼び通知とクールダウンに入る", async () => {
    const user = fakeUser();
    mockApp(user);
    render(<EmailVerifyBanner />);

    fireEvent.click(screen.getByRole("button", { name: "確認メールを再送" }));
    await waitFor(() =>
      expect(sendEmailVerification).toHaveBeenCalledWith(user),
    );
    expect(await screen.findByText(/再送しました/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "確認メールを再送" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("確認を反映: reload 後に確認済みならバナーが消える", async () => {
    const user = fakeUser();
    // 1回目(マウント時の自動チェック)は未確認のまま、
    // 2回目(ボタン押下)で確認済みに変わる
    vi.mocked(user.reload)
      .mockResolvedValueOnce(undefined)
      .mockImplementation(async () => {
        Object.defineProperty(user, "emailVerified", { value: true });
      });
    mockApp(user);
    render(<EmailVerifyBanner />);

    fireEvent.click(screen.getByRole("button", { name: "確認を反映" }));

    await waitFor(() => expect(screen.queryByText(/未確認です/)).toBeNull());
    expect(user.getIdToken).toHaveBeenCalledWith(true);
  });

  it("確認を反映: まだ未確認なら案内メッセージを表示する", async () => {
    mockApp(fakeUser());
    render(<EmailVerifyBanner />);

    fireEvent.click(screen.getByRole("button", { name: "確認を反映" }));

    expect(
      await screen.findByText(/まだ確認が完了していません/),
    ).toBeTruthy();
  });
});
