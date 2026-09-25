import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, notes, server, attachments, getToken, setToken, isNetworkError, ApiError, safeBlobType, isInlineImageType } from "./api";

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: "status",
    json: () => (body !== undefined ? Promise.resolve(body) : Promise.reject(new Error("no body"))),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("auth.deleteAccount", () => {
  beforeEach(() => setToken("session-token"));
  afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
  });

  it("sends DELETE /api/auth/account with the password and clears the token", async () => {
    const fetchMock = mockFetch(204);

    await auth.deleteAccount("my-password");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/auth/account");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ password: "my-password" });
    expect(getToken()).toBeNull();
  });

  it("does not auto-logout on a wrong-password 401", async () => {
    mockFetch(401, { error: "invalid credentials" });
    const logoutListener = vi.fn();
    window.addEventListener("nexus:logout", logoutListener);

    await expect(auth.deleteAccount("wrong")).rejects.toThrow(ApiError);

    // The session stays intact so the user can retype their password.
    expect(getToken()).toBe("session-token");
    expect(logoutListener).not.toHaveBeenCalled();
    window.removeEventListener("nexus:logout", logoutListener);
  });
});

describe("notes client checksum plumbing (e2ee vaults)", () => {
  beforeEach(() => setToken("session-token"));
  afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
  });

  it("create sends the plaintext checksum when given", async () => {
    const fetchMock = mockFetch(200, { id: "n1" });

    await notes.create("v1", "Title", "", "iv:cipher", "abc123");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.checksum).toBe("abc123");
  });

  it("create omits the checksum field for standard vaults", async () => {
    const fetchMock = mockFetch(200, { id: "n1" });

    await notes.create("v1", "Title", "", "plain content");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect("checksum" in body).toBe(false);
  });

  it("update sends both prev_checksum and the new plaintext checksum", async () => {
    const fetchMock = mockFetch(200, { id: "n1" });

    await notes.update("n1", "Title", "", "iv:cipher", "prev-sum", "next-sum");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prev_checksum).toBe("prev-sum");
    expect(body.checksum).toBe("next-sum");
  });
});

describe("access token refresh on 401 (#49)", () => {
  beforeEach(() => {
    setToken("stale-token");
    localStorage.setItem("nexus_refresh", "refresh-1");
  });
  afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
  });

  it("rotates the refresh token and replays the request once", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("/api/auth/refresh")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ token: "fresh-token", refresh_token: "refresh-2" }),
        });
      }
      // First data call 401s (stale token); the replay succeeds.
      const authed = (init?.headers as Record<string, string>)?.Authorization === "Bearer fresh-token";
      return Promise.resolve({
        ok: authed, status: authed ? 200 : 401, statusText: "s",
        json: () => Promise.resolve(authed ? [] : { error: "unauthorized" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const logoutListener = vi.fn();
    window.addEventListener("nexus:logout", logoutListener);

    const result = await notes.list("v1");

    expect(result).toEqual([]);
    expect(calls.filter((c) => c.includes("/api/auth/refresh"))).toHaveLength(1);
    expect(getToken()).toBe("fresh-token");
    expect(localStorage.getItem("nexus_refresh")).toBe("refresh-2");
    expect(logoutListener).not.toHaveBeenCalled();
    window.removeEventListener("nexus:logout", logoutListener);
  });

  it("keeps the session when the refresh cannot run (server unreachable or failing)", async () => {
    for (const refreshResult of ["network", 500] as const) {
      setToken("stale-token");
      localStorage.setItem("nexus_refresh", "refresh-1");
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/api/auth/refresh")) {
          if (refreshResult === "network") return Promise.reject(new TypeError("Failed to fetch"));
          return Promise.resolve({ ok: false, status: 500, statusText: "s", json: () => Promise.resolve({ error: "db down" }) });
        }
        return Promise.resolve({ ok: false, status: 401, statusText: "s", json: () => Promise.resolve({ error: "expired" }) });
      });
      vi.stubGlobal("fetch", fetchMock);
      const logoutListener = vi.fn();
      window.addEventListener("nexus:logout", logoutListener);

      const err = await notes.list("v1").catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(503);
      expect(logoutListener).not.toHaveBeenCalled();
      expect(getToken()).toBe("stale-token");
      expect(localStorage.getItem("nexus_refresh")).toBe("refresh-1");
      window.removeEventListener("nexus:logout", logoutListener);
    }
  });

  it("logs out when the refresh itself is rejected", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const isRefresh = String(url).includes("/api/auth/refresh");
      return Promise.resolve({
        ok: false, status: isRefresh ? 401 : 401, statusText: "s",
        json: () => Promise.resolve({ error: "nope" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const logoutListener = vi.fn();
    window.addEventListener("nexus:logout", logoutListener);

    await expect(notes.list("v1")).rejects.toThrow(ApiError);

    expect(logoutListener).toHaveBeenCalledOnce();
    expect(getToken()).toBeNull();
    expect(localStorage.getItem("nexus_refresh")).toBeNull();
    window.removeEventListener("nexus:logout", logoutListener);
  });
});

describe("isNetworkError", () => {
  it("is true for fetch network failures and timeouts, false for API errors", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new DOMException("timed out", "TimeoutError"))).toBe(true);
    expect(isNetworkError(new ApiError(401, "Unauthorized"))).toBe(false);
    expect(isNetworkError(new Error("boom"))).toBe(false);
  });
});

describe("server.status", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies a healthy server from GET /health", async () => {
    const fetchMock = mockFetch(200, { status: "ok", version: "0.5.2" });
    await expect(server.status()).resolves.toEqual({ state: "ok", serverVersion: "0.5.2" });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/health$/);
  });

  it("reports a version mismatch", async () => {
    mockFetch(200, { status: "ok", version: "9.0.0" });
    const status = await server.status();
    expect(status.state).toBe("mismatch");
  });

  it("is unreachable when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(server.status()).resolves.toEqual({ state: "unreachable" });
  });

  it("is unreachable when a 200 is not our health payload (e.g. another service on the port)", async () => {
    mockFetch(200); // body is not JSON
    await expect(server.status()).resolves.toEqual({ state: "unreachable" });
    mockFetch(200, { status: "degraded" });
    await expect(server.status()).resolves.toEqual({ state: "unreachable" });
  });

  it("is unreachable on a non-2xx answer (e.g. a proxy error page)", async () => {
    mockFetch(502, { error: "bad gateway" });
    await expect(server.status()).resolves.toEqual({ state: "unreachable" });
  });
});

describe("attachment blob types", () => {
  const raster = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"];
  // Types a blob URL must never keep: opened in a tab they are documents that
  // can run script in the app's origin (or are simply not raster images).
  const unsafe = [
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "text/xml",
    "application/xml",
    "application/atom+xml",
    "application/rss+xml",
    "text/javascript",
    "text/ecmascript",
    "application/pdf",
    "text/plain",
    "image/avif",
    "",
    "garbage",
  ];

  it("keeps raster image types, ignoring case and parameters", () => {
    for (const type of raster) {
      expect(safeBlobType(type)).toBe(type);
      expect(safeBlobType(`${type.toUpperCase()}; charset=binary`)).toBe(type);
      expect(isInlineImageType(type)).toBe(true);
    }
  });

  it("turns every other type into opaque bytes", () => {
    for (const type of unsafe) {
      expect(safeBlobType(type)).toBe("application/octet-stream");
      expect(isInlineImageType(type)).toBe(false);
    }
  });
});

describe("attachments.objectUrl", () => {
  const originalCreate = URL.createObjectURL;
  let created: Blob[];

  beforeEach(() => {
    setToken("session-token");
    created = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:test";
    }) as typeof URL.createObjectURL;
  });
  afterEach(() => {
    setToken(null);
    URL.createObjectURL = originalCreate;
    vi.unstubAllGlobals();
  });

  function serve(body: string, type: string) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob([body], { type })),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("fetches with the bearer token", async () => {
    const fetchMock = serve("x", "image/png");

    await expect(attachments.objectUrl("att-1")).resolves.toBe("blob:test");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/attachments/att-1");
    expect(init.headers.Authorization).toBe("Bearer session-token");
  });

  it("keeps a raster image's type so it can be shown inline", async () => {
    serve("png-bytes", "image/png");

    await attachments.objectUrl("att-1");

    expect(created[0].type).toBe("image/png");
  });

  it("never hands out an SVG or HTML blob, even if an old server sends one", async () => {
    for (const type of ["image/svg+xml", "text/html; charset=utf-8", "application/atom+xml"]) {
      created = [];
      serve("<svg onload=alert(1)>", type);

      await attachments.objectUrl("att-1");

      expect(created[0].type).toBe("application/octet-stream");
      // Same bytes, only the type changed (jsdom's Blob has no text()).
      expect(created[0].size).toBe("<svg onload=alert(1)>".length);
    }
  });
});
