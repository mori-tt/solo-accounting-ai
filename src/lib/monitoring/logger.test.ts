import { describe, expect, it, vi } from "vitest";
import {
  createLogger,
  sanitizeLogFields,
  serializeError,
  type LogEntry,
} from "./logger";

function makeSink() {
  const entries: LogEntry[] = [];
  return {
    entries,
    sink: (e: LogEntry) => entries.push(e),
    now: () => new Date("2026-11-02T00:00:00.000Z"),
  };
}

describe("createLogger", () => {
  it("level/msg/ts/fields を構造化して sink へ出力する", () => {
    const { entries, sink, now } = makeSink();
    const log = createLogger({ minLevel: "debug", sink, now });
    log.info("health check", { route: "/api/health", status: 200 });
    expect(entries).toEqual([
      {
        level: "info",
        msg: "health check",
        ts: "2026-11-02T00:00:00.000Z",
        route: "/api/health",
        status: 200,
      },
    ]);
  });

  it("minLevel 未満のログは捨てる", () => {
    const { entries, sink, now } = makeSink();
    const log = createLogger({ minLevel: "warn", sink, now });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(entries.map((e) => e.msg)).toEqual(["w", "e"]);
  });

  it("minLevel 未指定時は LOG_LEVEL env を読む(不正値は info)", () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const { entries, sink, now } = makeSink();
    const log = createLogger({ sink, now });
    log.info("dropped");
    log.warn("kept");
    expect(entries.map((e) => e.msg)).toEqual(["kept"]);
    vi.unstubAllEnvs();
  });

  it("PII系キーのフィールドを除去し redactedKeys に記録する", () => {
    const { entries, sink, now } = makeSink();
    const log = createLogger({ minLevel: "debug", sink, now });
    log.info("login failed", {
      route: "/login",
      email: "user@example.com",
      displayName: "山田太郎",
      idToken: "secret",
      receiptImage: "base64...",
      description: "摘要テキスト",
      businessId: "biz-1",
    });
    const e = entries[0];
    expect(e.route).toBe("/login");
    expect(e.businessId).toBe("biz-1");
    expect(e).not.toHaveProperty("email");
    expect(e).not.toHaveProperty("displayName");
    expect(e.redactedKeys).toEqual(
      expect.arrayContaining([
        "email",
        "displayName",
        "idToken",
        "receiptImage",
        "description",
      ]),
    );
  });

  it("非スカラー値・予約キー・非有限数を除去する", () => {
    const { entries, sink, now } = makeSink();
    const log = createLogger({ minLevel: "debug", sink, now });
    const safe: Record<string, string> = { route: "/x" };
    log.info("m", {
      ...safe,
      level: "evil",
      count: Number.NaN,
      ok: true,
      nothing: null,
    } as never);
    const e = entries[0];
    expect(e.level).toBe("info");
    expect(e.ok).toBe(true);
    expect(e.nothing).toBeNull();
    expect(e.redactedKeys).toEqual(
      expect.arrayContaining(["level", "count"]),
    );
  });

  it("値に含まれるメールアドレスをマスクし長文を打ち切る", () => {
    const { entries, sink, now } = makeSink();
    const log = createLogger({ minLevel: "debug", sink, now });
    log.info("m", {
      reason: "contact user@example.com please",
      long: "x".repeat(300),
    });
    expect(entries[0].reason).toBe("contact [redacted] please");
    expect(String(entries[0].long)).toHaveLength(201);
  });

  it("exception は Error を畳んで err に入れる", () => {
    const { entries, sink, now } = makeSink();
    const log = createLogger({ minLevel: "debug", sink, now });
    log.exception("failed", new TypeError("bad input a@b.jp"), { op: "save" });
    expect(entries[0].level).toBe("error");
    expect(entries[0].err).toMatchObject({
      name: "TypeError",
      message: "bad input [redacted]",
    });
    expect(entries[0].err?.stack).toBeDefined();
    expect(entries[0].op).toBe("save");
  });

  it("sink が投げても呼び出し側へ例外を返さない", () => {
    const log = createLogger({
      minLevel: "debug",
      sink: () => {
        throw new Error("sink broken");
      },
    });
    expect(() => log.error("m")).not.toThrow();
  });

  it("デフォルト sink は console に JSON 1行を出す", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = createLogger({ minLevel: "debug", now: makeSink().now });
    log.info("hello");
    expect(info).toHaveBeenCalledOnce();
    const parsed = JSON.parse(info.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "info", msg: "hello" });
    info.mockRestore();
  });
});

describe("sanitizeLogFields", () => {
  it("undefined/空 fields で空を返す", () => {
    expect(sanitizeLogFields(undefined)).toEqual({
      fields: {},
      redactedKeys: [],
    });
  });

  it("bigint を文字列化する", () => {
    const { fields } = sanitizeLogFields({ n: BigInt(10) });
    expect(fields.n).toBe("10");
  });
});

describe("serializeError", () => {
  it("非Error値は NonError として畳む", () => {
    expect(serializeError("oops")).toMatchObject({
      name: "NonError",
      message: "oops",
    });
    expect(serializeError(undefined)).toMatchObject({ name: "NonError" });
  });
});
