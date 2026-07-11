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
