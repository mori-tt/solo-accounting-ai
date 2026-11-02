import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ listCollections: vi.fn() }));

vi.mock("next/server", () => ({
  connection: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({ listCollections: mocks.listCollections }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.listCollections.mockReset();
});

describe("GET /api/health", () => {
  it("Emulator 未設定時は DB 疎通を省略して生存確認を返す", async () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      service: "solo-accounting-ai",
      checks: { db: "skipped" },
    });
    expect(typeof body.timestamp).toBe("string");
    expect(mocks.listCollections).not.toHaveBeenCalled();
  });

  it("Emulator 設定時は DB 疎通を試し ok を返す", async () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "localhost:8080");
    mocks.listCollections.mockResolvedValue([]);
    const res = await GET();
    const body = await res.json();
    expect(body.checks.db).toBe("ok");
    expect(mocks.listCollections).toHaveBeenCalledOnce();
  });

  it("DB 疎通失敗でも 200 を返し checks.db=error と警告ログを出す", async () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "localhost:8080");
    mocks.listCollections.mockRejectedValue(new Error("unreachable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checks.db).toBe("error");
    expect(warn).toHaveBeenCalledOnce();
    const entry = JSON.parse(warn.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      level: "warn",
      msg: "health check: db unreachable",
    });
  });
});
