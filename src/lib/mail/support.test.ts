import { describe, expect, it } from "vitest";
import { APP_VERSION } from "@/lib/version";
import { buildSupportMail, SUPPORT_EMAIL } from "./support";

describe("buildSupportMail", () => {
  it("サポート窓口のアドレスを宛先にする", () => {
    const mail = buildSupportMail({});
    expect(mail.to).toBe(SUPPORT_EMAIL);
  });

  it("種別を件名に含める", () => {
    const mail = buildSupportMail({ category: "不具合の報告" });
    expect(mail.subject).toContain("お問い合わせ");
    expect(mail.subject).toContain("不具合の報告");
  });

  it("入力内容を本文に含め、アプリバージョンを付記する", () => {
    const mail = buildSupportMail({ message: "ログインできません" });
    expect(mail.body).toContain("ログインできません");
    expect(mail.body).toContain(`アプリバージョン: ${APP_VERSION}`);
  });

  it("内容未入力でも定型文で組み立てられる", () => {
    const mail = buildSupportMail({ category: "その他", message: "  " });
    expect(mail.to).toBe(SUPPORT_EMAIL);
    expect(mail.body).toContain("お問い合わせ内容をここにご記入ください");
  });
});
