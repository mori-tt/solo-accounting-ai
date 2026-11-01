import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertFirebaseClientEnvOnce,
  EnvValidationError,
  leftoverEmulatorHostEnv,
  missingFirebaseClientEnv,
  REQUIRED_FIREBASE_CLIENT_ENV,
  resetEnvValidationForTest,
  usesEmulator,
  validateFirebaseClientEnv,
  warnIfProductionWithEmulatorHost,
} from "./env";

const FILLED = Object.fromEntries(
  REQUIRED_FIREBASE_CLIENT_ENV.map((key) => [key, "value"]),
);

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvValidationForTest();
});

describe("missingFirebaseClientEnv", () => {
  it("全て設定済みなら空配列", () => {
    expect(missingFirebaseClientEnv(FILLED)).toEqual([]);
  });

  it("未設定・空文字・空白のみのキーを列挙する", () => {
    const env = { ...FILLED, NEXT_PUBLIC_FIREBASE_API_KEY: "" };
    expect(missingFirebaseClientEnv(env)).toEqual([
      "NEXT_PUBLIC_FIREBASE_API_KEY",
    ]);
    expect(
      missingFirebaseClientEnv({
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "  ",
      }),
    ).toEqual([...REQUIRED_FIREBASE_CLIENT_ENV]);
  });
});

describe("validateFirebaseClientEnv", () => {
  it("不足キー名を含む EnvValidationError を投げる", () => {
    expect(() => validateFirebaseClientEnv({})).toThrow(EnvValidationError);
    expect(() => validateFirebaseClientEnv({})).toThrow(
      /NEXT_PUBLIC_FIREBASE_API_KEY/,
    );
    expect(() => validateFirebaseClientEnv({})).toThrow(
      /NEXT_PUBLIC_FIREBASE_APP_ID/,
    );
  });

  it("揃っていれば投げない", () => {
    expect(() => validateFirebaseClientEnv(FILLED)).not.toThrow();
  });
});

describe("leftoverEmulatorHostEnv", () => {
  it("Emulator使用中なら警告対象なし", () => {
    expect(
      leftoverEmulatorHostEnv({
        NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
      }),
    ).toEqual([]);
  });

  it("本番(USE_EMULATOR!=true)で残っている host を列挙する", () => {
    expect(
      leftoverEmulatorHostEnv({
        NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: "localhost:8080",
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
        NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "false",
      }),
    ).toEqual([
      "NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST",
      "FIRESTORE_EMULATOR_HOST",
    ]);
  });
});

describe("usesEmulator", () => {
  it('"true" のときのみ true', () => {
    expect(usesEmulator({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true" })).toBe(
      true,
    );
    expect(usesEmulator({})).toBe(false);
    expect(usesEmulator({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "1" })).toBe(
      false,
    );
  });
});

describe("warnIfProductionWithEmulatorHost", () => {
  it("本番で Emulator host が残っていれば警告する", () => {
    const warn = vi.fn();
    warnIfProductionWithEmulatorHost(
      { FIRESTORE_EMULATOR_HOST: "localhost:8080" },
      warn,
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("FIRESTORE_EMULATOR_HOST");
  });

  it("Emulator使用中・host未設定なら警告しない", () => {
    const warn = vi.fn();
    warnIfProductionWithEmulatorHost(
      {
        NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
      },
      warn,
    );
    warnIfProductionWithEmulatorHost({}, warn);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("assertFirebaseClientEnvOnce", () => {
  it("process.env の不足で EnvValidationError を投げる", () => {
    for (const key of REQUIRED_FIREBASE_CLIENT_ENV) {
      vi.stubEnv(key, "");
    }
    expect(() => assertFirebaseClientEnvOnce()).toThrow(EnvValidationError);
  });

  it("警告は1回だけ出力される", () => {
    for (const key of REQUIRED_FIREBASE_CLIENT_ENV) {
      vi.stubEnv(key, "value");
    }
    vi.stubEnv("NEXT_PUBLIC_USE_FIREBASE_EMULATOR", "");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "localhost:8080");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    assertFirebaseClientEnvOnce();
    assertFirebaseClientEnvOnce();
    expect(warn).toHaveBeenCalledOnce();
  });
});
