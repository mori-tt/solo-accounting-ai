import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMULATOR_DEFAULTS,
  getFirebaseConfig,
  parseEmulatorHost,
  shouldUseEmulator,
} from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getFirebaseConfig", () => {
  it("NEXT_PUBLIC_FIREBASE_* から設定を組み立てる", () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "key");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-project");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "app-id");

    const config = getFirebaseConfig();
    expect(config.apiKey).toBe("key");
    expect(config.projectId).toBe("demo-project");
    expect(config.appId).toBe("app-id");
  });

  it("未設定の環境変数は空文字になる", () => {
    const config = getFirebaseConfig();
    expect(config.apiKey).toBe("");
    expect(config.projectId).toBe("");
  });
});

describe("shouldUseEmulator", () => {
  it("NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true のとき true", () => {
    vi.stubEnv("NEXT_PUBLIC_USE_FIREBASE_EMULATOR", "true");
    expect(shouldUseEmulator()).toBe(true);
  });

  it("未設定や別値なら false", () => {
    expect(shouldUseEmulator()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_USE_FIREBASE_EMULATOR", "1");
    expect(shouldUseEmulator()).toBe(false);
  });
});

describe("parseEmulatorHost", () => {
  it("host:port をパースする", () => {
    expect(parseEmulatorHost("localhost:8080", EMULATOR_DEFAULTS.auth)).toEqual({
      host: "localhost",
      port: 8080,
    });
  });

  it("スキーム付きでもパースする", () => {
    expect(
      parseEmulatorHost("http://127.0.0.1:9099", EMULATOR_DEFAULTS.auth),
    ).toEqual({ host: "127.0.0.1", port: 9099 });
  });

  it("未設定・不正な値はフォールバックを返す", () => {
    expect(parseEmulatorHost(undefined, EMULATOR_DEFAULTS.firestore)).toEqual(
      EMULATOR_DEFAULTS.firestore,
    );
    expect(parseEmulatorHost("localhost", EMULATOR_DEFAULTS.firestore)).toEqual(
      EMULATOR_DEFAULTS.firestore,
    );
    expect(
      parseEmulatorHost("localhost:abc", EMULATOR_DEFAULTS.firestore),
    ).toEqual(EMULATOR_DEFAULTS.firestore);
  });
});
