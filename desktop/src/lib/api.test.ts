import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, notes, getToken, setToken, ApiError } from "./api";

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
