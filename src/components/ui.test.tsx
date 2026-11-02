import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  announce,
  ConfirmDialog,
  Field,
  issuesByField,
  LiveAnnouncer,
  TextInput,
} from "./ui";

afterEach(cleanup);

describe("Field", () => {
  it("label を htmlFor/id で入力コントロールに関連付ける", () => {
    render(
      <Field label="メールアドレス">
        <TextInput type="email" />
      </Field>,
    );

    const input = screen.getByLabelText("メールアドレス");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("id")).toBeTruthy();
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("error 指定時に aria-invalid と aria-describedby を注入する", () => {
    render(
      <Field label="金額(円)" error="金額は1円以上で入力してください">
        <TextInput />
      </Field>,
    );

    const input = screen.getByLabelText("金額(円)");
    const message = screen.getByText("金額は1円以上で入力してください");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(message.id).toBeTruthy();
  });

  it("hint 指定時は hint を aria-describedby で参照する", () => {
    render(
      <Field label="パスワード" hint="6文字以上">
        <TextInput type="password" />
      </Field>,
    );

    const input = screen.getByLabelText("パスワード");
    const hint = screen.getByText("6文字以上");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("子要素が既に id を持つ場合はその id で関連付ける", () => {
    render(
      <Field label="事業名">
        <TextInput id="business-name" />
      </Field>,
    );

    const input = screen.getByLabelText("事業名");
    expect(input.getAttribute("id")).toBe("business-name");
  });
});

describe("issuesByField", () => {
  it('"path: message" 形式をフィールドマップへ変換する', () => {
    const errors = issuesByField([
      "email: メールアドレスの形式が正しくありません",
      "password: パスワードは6文字以上で入力してください",
    ]);
    expect(errors.email).toBe("メールアドレスの形式が正しくありません");
    expect(errors.password).toBe(
      "パスワードは6文字以上で入力してください",
    );
  });

  it("パスを持たない issue は _form にまとめる", () => {
    const errors = issuesByField(["入力内容を確認してください"]);
    expect(errors._form).toBe("入力内容を確認してください");
  });
});

describe("ConfirmDialog", () => {
  function renderDialog() {
    function Wrapper() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            削除する
          </button>
          <ConfirmDialog
            open={open}
            title="削除の確認"
            message="本当に削除しますか"
            onConfirm={vi.fn()}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Wrapper />);
  }

  it("open になるまで描画しない", () => {
    renderDialog();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("開くとキャンセルボタンへフォーカスし、Escape で onCancel が呼ばれる", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    const cancel = screen.getByRole("button", { name: "キャンセル" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Tab/Shift+Tab はダイアログ内で循環する(フォーカストラップ)", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    const cancel = screen.getByRole("button", { name: "キャンセル" });
    const confirm = screen.getByRole("button", { name: "実行する" });

    // 先頭で Shift+Tab → 末尾へ
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    // 末尾で Tab → 先頭へ
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
  });

  it("閉じると開く前にフォーカスしていた要素へ戻る", () => {
    renderDialog();
    const trigger = screen.getByRole("button", { name: "削除する" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(document.activeElement).toBe(trigger);
  });
});

describe("LiveAnnouncer", () => {
  it("announce() のメッセージが polite/assertive 領域に流れる", () => {
    render(<LiveAnnouncer />);

    act(() => announce("保存しました"));
    expect(screen.getByRole("status").textContent).toBe("保存しました");
    expect(screen.getByRole("alert").textContent).toBe("");

    act(() => announce("削除に失敗しました", true));
    expect(screen.getByRole("alert").textContent).toBe("削除に失敗しました");
  });

  it("同一メッセージの連続通知も新しい要素として挿される", () => {
    render(<LiveAnnouncer />);
    act(() => announce("保存しました"));
    const first = screen.getByRole("status").firstElementChild;
    act(() => announce("保存しました"));
    const second = screen.getByRole("status").firstElementChild;
    expect(second).not.toBe(first);
    expect(second?.textContent).toBe("保存しました");
  });

  it("アナウンサー未マウントでも announce() はエラーにならない", () => {
    expect(() => announce("テスト")).not.toThrow();
  });
});
