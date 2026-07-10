import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, getToken, setToken, ApiError } from "./api";

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
