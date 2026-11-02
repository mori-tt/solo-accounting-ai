import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth, User } from "firebase/auth";
import {
  ApiClientError,
  callApi,
  fetchAiSuggestions,
  restoreBackup,
  setSessionExpiredHandler,
} from "./api-client";

const mocks = vi.hoisted(() => ({
  getFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/firebase/client", () => ({
  getFirebaseAuth: mocks.getFirebaseAuth,
}));

const fetchMock = vi.fn<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status });
}

function errorEnvelope(
  status: number,
  code: string,
  headers?: HeadersInit,
): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message: "error" } }),
    { status, headers },
  );
}

/** 未ログインのAuth。getIdTokenは呼ばれない */
function signedOutAuth(signOut = vi.fn(async () => {})): Auth {
  return { currentUser: null, signOut } as unknown as Auth;
}

/** ログイン済みAuth。refreshSession経由で /api/session が呼ばれる */
function signedInAuth(signOut = vi.fn(async () => {})): Auth {
  const user = {
    getIdToken: vi.fn(async () => "id-token"),
  } as unknown as User;
  return { currentUser: user, signOut } as unknown as Auth;
}

/** /api/session は常に成功、その他は responder 任せ */
function routeSessionThrough(
  responder: (url: string) => Promise<Response>,
): (input: RequestInfo | URL) => Promise<Response> {
  return (input) =>
    String(input).startsWith("/api/session")
      ? Promise.resolve(envelope(null))
      : responder(String(input));
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockReset()
    .mockImplementation(() => Promise.reject(new Error("fetch not mocked")));
  mocks.getFirebaseAuth.mockReturnValue(signedOutAuth());
  // モジュール内の発火済みガードもリセットされる
  setSessionExpiredHandler(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("429リトライ", () => {
  it("GETはRetry-Afterの秒数だけ待ってリトライし成功する", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        errorEnvelope(429, "RATE_LIMITED", { "Retry-After": "2" }),
      )
      .mockResolvedValueOnce(envelope([{ id: "s1" }]));

    const p = fetchAiSuggestions("biz-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual([{ id: "s1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Retry-Afterが無ければ指数バックオフ(500ms→1000ms)でリトライする", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(errorEnvelope(429, "RATE_LIMITED"))
      .mockResolvedValueOnce(errorEnvelope(429, "RATE_LIMITED"))
      .mockResolvedValueOnce(envelope([]));

    const p = fetchAiSuggestions("biz-1");
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("429が続く場合は最大2回リトライ後にRATE_LIMITEDで失敗する", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(errorEnvelope(429, "RATE_LIMITED"));

    const p = fetchAiSuggestions("biz-1");
    const assertion = expect(p).rejects.toMatchObject({
      name: "ApiClientError",
      code: "RATE_LIMITED",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    // 初回+リトライ2回=計3回
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("Retry-Afterが上限(30s)超過ならリトライせず即座に失敗する", async () => {
    vi.useFakeTimers();
    // 固定ウィンドウ(1h)の残り全期間を返し得るため上限で打ち切る
    fetchMock.mockResolvedValue(
      errorEnvelope(429, "RATE_LIMITED", { "Retry-After": "3600" }),
    );

    await expect(fetchAiSuggestions("biz-1")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("POSTは429でもリトライしない(副作用の二重実行防止)", async () => {
    fetchMock.mockResolvedValue(
      errorEnvelope(429, "RATE_LIMITED", { "Retry-After": "1" }),
    );

    await expect(restoreBackup("biz-1", {})).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("タイムアウト・ネットワーク", () => {
  it("デフォルト20秒で中断しTIMEOUTエラーになる", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (...args) =>
        // 解決しないまま abort されたら reject する(fetchの中断を模倣)
        new Promise<Response>((...[, reject]) => {
          args[1]?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const p = fetchAiSuggestions("biz-1");
    const assertion = expect(p).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetch自体の失敗はNETWORKエラーになる", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchAiSuggestions("biz-1")).rejects.toMatchObject({
      code: "NETWORK",
    });
  });
});

describe("401セッション切れ", () => {
  it("401→セッション再発行→1回だけリトライして成功する", async () => {
    mocks.getFirebaseAuth.mockReturnValue(signedInAuth());
    let apiCalls = 0;
    fetchMock.mockImplementation(
      routeSessionThrough(() => {
        apiCalls += 1;
        return Promise.resolve(
          apiCalls === 1
            ? errorEnvelope(401, "UNAUTHORIZED")
            : envelope([{ id: "s1" }]),
        );
      }),
    );

    await expect(fetchAiSuggestions("biz-1")).resolves.toEqual([{ id: "s1" }]);
    // API 2回 + /api/session 1回
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith("/api/session"),
      ),
    ).toBe(true);
  });

  it("401→再発行成功後も401なら再リトライせずセッション切れハンドラを呼ぶ", async () => {
    mocks.getFirebaseAuth.mockReturnValue(signedInAuth());
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    fetchMock.mockImplementation(
      routeSessionThrough(() =>
        Promise.resolve(errorEnvelope(401, "UNAUTHORIZED")),
      ),
    );

    await expect(fetchAiSuggestions("biz-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    // API 2回 + session 1回で打ち止め(無限ループしない)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("セッション再発行が失敗した場合もハンドラを呼んでUNAUTHORIZEDを投げる", async () => {
    mocks.getFirebaseAuth.mockReturnValue(signedOutAuth());
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorEnvelope(401, "UNAUTHORIZED")),
    );

    await expect(fetchAiSuggestions("biz-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("POSTの401でも再発行後に1回だけリトライする", async () => {
    mocks.getFirebaseAuth.mockReturnValue(signedInAuth());
    let apiCalls = 0;
    fetchMock.mockImplementation(
      routeSessionThrough(() => {
        apiCalls += 1;
        return Promise.resolve(
          apiCalls === 1
            ? errorEnvelope(401, "UNAUTHORIZED")
            : envelope({ restored: 1 }),
        );
      }),
    );

    await expect(restoreBackup("biz-1", {})).resolves.toEqual({
      restored: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ハンドラ未設定時はFirebaseサインアウトへ委譲する(認証ゲートが /login へ遷移)", async () => {
    const signOut = vi.fn(async () => {});
    mocks.getFirebaseAuth.mockReturnValue(signedOutAuth(signOut));
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorEnvelope(401, "UNAUTHORIZED")),
    );

    await expect(fetchAiSuggestions("biz-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("連続するセッション切れは10秒のデバウンスでハンドラ1回に抑える", async () => {
    mocks.getFirebaseAuth.mockReturnValue(signedOutAuth());
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorEnvelope(401, "UNAUTHORIZED")),
    );

    vi.useFakeTimers();
    await expect(fetchAiSuggestions("biz-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(fetchAiSuggestions("biz-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(onExpired).toHaveBeenCalledTimes(1);

    // デバウンス窓を越えれば再び発火する
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(fetchAiSuggestions("biz-1")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(onExpired).toHaveBeenCalledTimes(2);
  });
});

describe("callApi(Server Action)", () => {
  it("UNAUTHORIZED→セッション再発行→リトライで成功する", async () => {
    mocks.getFirebaseAuth.mockReturnValue(signedInAuth());
    fetchMock.mockImplementation(
      routeSessionThrough(() => Promise.resolve(envelope(null))),
    );
    const action = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "ログインが必要です" },
      })
      .mockResolvedValueOnce({ ok: true, data: 42 });

    await expect(callApi(action)).resolves.toBe(42);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("UNAUTHORIZEDが解消しない場合はセッション切れハンドラを呼んで投げる", async () => {
    mocks.getFirebaseAuth.mockReturnValue(signedInAuth());
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    fetchMock.mockImplementation(
      routeSessionThrough(() => Promise.resolve(envelope(null))),
    );
    const action = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "ログインが必要です" },
    });

    await expect(callApi(action)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("UNAUTHORIZED以外のエラーはそのまま投げる", async () => {
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    const action = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "RATE_LIMITED", message: "too many" },
    });

    await expect(callApi(action)).rejects.toBeInstanceOf(ApiClientError);
    expect(action).toHaveBeenCalledTimes(1);
    expect(onExpired).not.toHaveBeenCalled();
  });
});
