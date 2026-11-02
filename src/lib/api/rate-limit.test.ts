import { describe, expect, it } from "vitest";
import { ApiError } from "./result";
import {
  clientIpKey,
  createRateLimiter,
  RateLimitError,
} from "./rate-limit";

describe("createRateLimiter", () => {
  it("上限までは消費でき、超過で RateLimitError(ApiError RATE_LIMITED)", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(() => {
      limiter.consume("biz-1");
      limiter.consume("biz-1");
      limiter.consume("biz-1");
    }).not.toThrow();

    try {
      limiter.consume("biz-1");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("RATE_LIMITED");
      expect((e as RateLimitError).retryAfterSec).toBeGreaterThan(0);
      expect((e as RateLimitError).retryAfterSec).toBeLessThanOrEqual(60);
    }
  });

  it("key(businessId)ごとに独立してカウントする", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.consume("biz-1");
    expect(() => limiter.consume("biz-2")).not.toThrow();
    expect(() => limiter.consume("biz-1")).toThrow(RateLimitError);
  });

  it("ウィンドウ経過で回復する(固定ウィンドウ)", () => {
    let nowMs = 1_000_000;
    const limiter = createRateLimiter(
      { limit: 2, windowMs: 60_000 },
      () => nowMs,
    );
    limiter.consume("biz-1");
    limiter.consume("biz-1");
    expect(() => limiter.consume("biz-1")).toThrow(RateLimitError);

    nowMs += 60_001;
    expect(() => limiter.consume("biz-1")).not.toThrow();
  });

  it("remaining は残り回数を返す", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.remaining("biz-1")).toBe(2);
    limiter.consume("biz-1");
    expect(limiter.remaining("biz-1")).toBe(1);
    limiter.consume("biz-1");
    expect(limiter.remaining("biz-1")).toBe(0);
  });

  it("reset で全バケットが破棄される", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.consume("biz-1");
    expect(() => limiter.consume("biz-1")).toThrow(RateLimitError);
    limiter.reset();
    expect(() => limiter.consume("biz-1")).not.toThrow();
  });
});

describe("clientIpKey", () => {
  function requestWith(headers: Record<string, string>): Request {
    return new Request("http://localhost/api/session", { headers });
  }

  it("x-forwarded-for の最右IPを使う(先頭はクライアント偽装可能)", () => {
    const req = requestWith({
      "x-forwarded-for": "203.0.113.1, 10.0.0.1, 10.0.0.2",
    });
    expect(clientIpKey(req)).toBe("10.0.0.2");
  });

  it("x-forwarded-for が無ければ x-real-ip にフォールバック", () => {
    const req = requestWith({ "x-real-ip": "198.51.100.7" });
    expect(clientIpKey(req)).toBe("198.51.100.7");
  });

  it("両方無ければ unknown(共有バケット)", () => {
    expect(clientIpKey(requestWith({}))).toBe("unknown");
  });

  it("x-forwarded-for が空・空白のみなら x-real-ip/unknown へ", () => {
    expect(
      clientIpKey(requestWith({ "x-forwarded-for": " , " })),
    ).toBe("unknown");
    expect(
      clientIpKey(
        requestWith({
          "x-forwarded-for": "",
          "x-real-ip": "192.0.2.10",
        }),
      ),
    ).toBe("192.0.2.10");
  });
});
