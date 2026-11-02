import { describe, expect, it, vi } from "vitest";
import { buildMailtoUrl, MailtoMailSender } from "./mailto";

describe("buildMailtoUrl", () => {
  it("宛先・件名・本文からmailto:URLを組み立てる", () => {
    const url = buildMailtoUrl({
      to: "customer@example.com",
      subject: "請求書のお知らせ",
      body: "本文です",
    });
    expect(url.startsWith("mailto:customer@example.com?")).toBe(true);
    expect(url).toContain(`subject=${encodeURIComponent("請求書のお知らせ")}`);
    expect(url).toContain(`body=${encodeURIComponent("本文です")}`);
  });

  it("空白は + ではなく %20 にエンコードする", () => {
    const url = buildMailtoUrl({ subject: "a b", body: "" });
    expect(url).toContain("subject=a%20b");
    expect(url).not.toContain("+");
  });

  it("本文の改行は %0A にエンコードされる", () => {
    const url = buildMailtoUrl({ subject: "s", body: "1行目\n2行目" });
    expect(url).toContain(`body=${encodeURIComponent("1行目\n2行目")}`);
    expect(url).toContain("%0A");
  });

  it("宛先なしでもクエリを組み立てられる", () => {
    const url = buildMailtoUrl({ subject: "s", body: "b" });
    expect(url.startsWith("mailto:?")).toBe(true);
  });

  it("件名・本文が空ならクエリを付けない", () => {
    expect(buildMailtoUrl({ to: "a@b.c", subject: "", body: "" })).toBe(
      "mailto:a@b.c",
    );
  });
});

describe("MailtoMailSender", () => {
  it("kind は mailto", () => {
    expect(new MailtoMailSender().kind).toBe("mailto");
  });

  it("send は組み立てた mailto URL へ遷移して ok を返す", async () => {
    const navigate = vi.fn();
    const sender = new MailtoMailSender(navigate);
    const result = await sender.send({
      to: "a@b.c",
      subject: "件名",
      body: "本文",
    });
    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
    const url = navigate.mock.calls[0][0];
    expect(url.startsWith("mailto:a@b.c?")).toBe(true);
    expect(url).toContain(`subject=${encodeURIComponent("件名")}`);
  });
});
