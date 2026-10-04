import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { server } from "./api";
import { SERVER_REACHABLE_EVENT, SERVER_SUSPECT_EVENT } from "./connection";
import { useServerStatus } from "./useServerStatus";
import type { ServerStatus } from "./version";

const ok: ServerStatus = { state: "ok" };
const down: ServerStatus = { state: "unreachable" };

describe("useServerStatus (#333)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("checks at once when a request hints at an outage, then announces the return", async () => {
    const status = vi.spyOn(server, "status").mockResolvedValue(ok);
    const reachable = vi.fn();
    window.addEventListener(SERVER_REACHABLE_EVENT, reachable);
    const { result } = renderHook(() => useServerStatus());
    await act(async () => {});
    expect(status).toHaveBeenCalledTimes(1);

    // Healthy polling waits 30 s; a suspect event checks now.
    status.mockResolvedValue(down);
    await act(async () => {
      window.dispatchEvent(new CustomEvent(SERVER_SUSPECT_EVENT));
    });
    expect(status).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(down);

    // While down it polls every 4 s; the first healthy answer fires the event.
    status.mockResolvedValue(ok);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(result.current).toEqual(ok);
    expect(reachable).toHaveBeenCalledTimes(1);
    window.removeEventListener(SERVER_REACHABLE_EVENT, reachable);
  });

  it("ignores suspect events while it already polls fast", async () => {
    const status = vi.spyOn(server, "status").mockResolvedValue(down);
    renderHook(() => useServerStatus());
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(new CustomEvent(SERVER_SUSPECT_EVENT));
    });
    expect(status).toHaveBeenCalledTimes(1);
  });
});
