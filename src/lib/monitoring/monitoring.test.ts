import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureException,
  captureMessage,
  ConsoleMonitoringProvider,
  createMonitoringProvider,
  NoopMonitoringProvider,
  resetMonitoringForTest,
  setMonitoringProviderForTest,
} from "./index";
import type { MonitoringProvider } from "./types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetMonitoringForTest();
});

describe("captureException", () => {
  it("SENTRY_DSN 未設定時は console へ構造化出力する", () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("LOG_LEVEL", "debug");
    const errOut = vi.spyOn(console, "error").mockImplementation(() => {});
    captureException(new Error("boom"), {
      tags: { feature: "backup" },
      extra: { route: "/api/backup" },
    });
    expect(errOut).toHaveBeenCalledOnce();
    const entry = JSON.parse(errOut.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      level: "error",
      msg: "monitoring captured exception",
      kind: "exception",
      route: "/api/backup",
      "tag.feature": "backup",
    });
    expect(entry.err).toMatchObject({ name: "Error", message: "boom" });
  });

  it("プロバイダが投げても呼び出し側は例外を受けない", () => {
    const broken: MonitoringProvider = {
      captureException: () => {
        throw new Error("backend down");
      },
      captureMessage: () => {
        throw new Error("backend down");
      },
    };
    setMonitoringProviderForTest(broken);
    expect(() => captureException(new Error("x"))).not.toThrow();
    expect(() => captureMessage("x", "error")).not.toThrow();
  });
});

describe("captureMessage", () => {
  it("level を logger のレベルへ対応させる", () => {
    setMonitoringProviderForTest(new ConsoleMonitoringProvider());
    vi.stubEnv("LOG_LEVEL", "debug");
    const errOut = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnOut = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoOut = vi.spyOn(console, "info").mockImplementation(() => {});
    const debugOut = vi.spyOn(console, "debug").mockImplementation(() => {});

    captureMessage("fatal-msg", "fatal");
    captureMessage("err-msg", "error");
    captureMessage("warn-msg", "warning");
    captureMessage("info-msg", "info");
    captureMessage("debug-msg", "debug");

    expect(JSON.parse(errOut.mock.calls[0][0] as string).msg).toBe("fatal-msg");
    expect(JSON.parse(errOut.mock.calls[1][0] as string).msg).toBe("err-msg");
    expect(JSON.parse(warnOut.mock.calls[0][0] as string).msg).toBe("warn-msg");
    expect(JSON.parse(infoOut.mock.calls[0][0] as string).msg).toBe("info-msg");
    expect(JSON.parse(debugOut.mock.calls[0][0] as string).msg).toBe(
      "debug-msg",
    );
  });
});

describe("createMonitoringProvider", () => {
  it("SENTRY_DSN 設定時は SDK 不在の警告を出し console フォールバックを返す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = createMonitoringProvider({ SENTRY_DSN: "https://x@y/1" });
    expect(p).toBeInstanceOf(ConsoleMonitoringProvider);
    expect(warn).toHaveBeenCalledOnce();
    // DSN の値自体はログへ出さない
    expect(warn.mock.calls[0][0]).not.toContain("https://x@y/1");
  });

  it("未設定時は警告なしで console フォールバックを返す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = createMonitoringProvider({});
    expect(p).toBeInstanceOf(ConsoleMonitoringProvider);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("NoopMonitoringProvider", () => {
  it("注入すると一切出力しない", () => {
    setMonitoringProviderForTest(new NoopMonitoringProvider());
    const errOut = vi.spyOn(console, "error").mockImplementation(() => {});
    captureException(new Error("x"));
    captureMessage("x", "error");
    expect(errOut).not.toHaveBeenCalled();
  });
});
