import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Field, issuesByField, TextInput } from "./ui";

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
