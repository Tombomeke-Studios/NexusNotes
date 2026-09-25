import { describe, it, expect } from "vitest";
import { ApiError } from "./api";
import { restoreFailureAction } from "./session";

describe("restoreFailureAction", () => {
  it("keeps the session and waits when the server cannot be reached", () => {
    expect(restoreFailureAction(new TypeError("Failed to fetch"))).toBe("wait");
    expect(restoreFailureAction(new DOMException("timed out", "TimeoutError"))).toBe("wait");
  });

  it("signs out only when the server rejects the session", () => {
    expect(restoreFailureAction(new ApiError(401, "Unauthorized"))).toBe("sign-out");
    expect(restoreFailureAction(new ApiError(403, "Forbidden"))).toBe("sign-out");
    // /api/auth/me answers 404 only when the account no longer exists.
    expect(restoreFailureAction(new ApiError(404, "user not found"))).toBe("sign-out");
  });

  it("keeps the session on server-side failures such as a database outage", () => {
    expect(restoreFailureAction(new ApiError(500, "internal error"))).toBe("wait");
    expect(restoreFailureAction(new ApiError(503, "unavailable"))).toBe("wait");
    expect(restoreFailureAction(new ApiError(429, "slow down"))).toBe("wait");
  });

  it("signs out on anything unexpected rather than waiting forever", () => {
    expect(restoreFailureAction(new Error("boom"))).toBe("sign-out");
    expect(restoreFailureAction("weird")).toBe("sign-out");
  });
});
