import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setToken } from "./api";
import { SyncClient } from "./sync";

/** Minimal stand-in for the browser WebSocket: records every socket opened. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  /** Simulates the server dropping the connection. */
  drop() {
    this.closed = true;
    this.onclose?.({});
  }
}

function ticketResponse(ticket: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve({ ticket, expires_in: 30 }),
  };
}

/** A fetch mock that hands out t-1, t-2, ... on each ticket request. */
function mockTicketFetch() {
  let n = 0;
  const fn = vi.fn().mockImplementation(() => Promise.resolve(ticketResponse(`t-${++n}`)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function ticketOf(ws: FakeWebSocket): string | null {
  return new URL(ws.url).searchParams.get("ticket");
}

describe("SyncClient WebSocket auth (#258)", () => {
  let client: SyncClient;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    setToken("session-token");
    client = new SyncClient();
  });

  afterEach(() => {
    client.disconnect();
    setToken(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches a ticket with the bearer token, then connects with the ticket in the URL", async () => {
    const fetchMock = mockTicketFetch();

    client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/ws\/ticket$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer session-token");

    const ws = FakeWebSocket.instances[0];
    const params = new URL(ws.url).searchParams;
    expect(new URL(ws.url).pathname).toBe("/ws");
    expect(params.get("ticket")).toBe("t-1");
    expect(params.get("device_id")).toBeTruthy();
    // The long-lived access token must never appear in the URL.
    expect(params.has("token")).toBe(false);
    expect(ws.url).not.toContain("session-token");
  });

  it("neither fetches a ticket nor connects without a session token", async () => {
    setToken(null);
    const fetchMock = mockTicketFetch();

    client.connect();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("fetches a fresh ticket for every reconnect", async () => {
    vi.useFakeTimers();
    const fetchMock = mockTicketFetch();

    client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].drop();

    // Reconnect backoff starts at one second.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances.map(ticketOf)).toEqual(["t-1", "t-2"]);
  });

  // Updates made while the socket was down are never pushed again, so the app
  // must be told to resync after a reconnect, not after the first connect (#388).
  it("announces a reconnect, but not the first connect", async () => {
    vi.useFakeTimers();
    mockTicketFetch();
    const seen: string[] = [];
    client.onMessage((type) => seen.push(type));

    client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onopen?.({});
    expect(seen).toEqual([]);

    FakeWebSocket.instances[0].drop();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances[1].onopen?.({});
    expect(seen).toEqual(["sync:reconnected"]);
  });

  it("retries with backoff when the ticket request fails", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValue(ticketResponse("t-ok"));
    vi.stubGlobal("fetch", fetchMock);

    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(ticketOf(FakeWebSocket.instances[0])).toBe("t-ok");
  });

  it("does not open a socket when disconnected while the ticket is in flight", async () => {
    let release!: () => void;
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve(ticketResponse("late"));
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    client.connect();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    client.disconnect();
    release();
    await new Promise((r) => setTimeout(r, 0));

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("does not reconnect after an explicit disconnect", async () => {
    vi.useFakeTimers();
    const fetchMock = mockTicketFetch();

    client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    client.disconnect();
    FakeWebSocket.instances[0].drop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("SyncClient messages and backoff (#266)", () => {
  let client: SyncClient;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    setToken("session-token");
    client = new SyncClient();
  });

  afterEach(() => {
    client.disconnect();
    setToken(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function connected(): Promise<FakeWebSocket> {
    mockTicketFetch();
    client.connect();
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    ws.onopen?.({});
    return ws;
  }

  it("hands each message to every handler, until they unsubscribe", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = client.onMessage(a);
    client.onMessage(b);
    const ws = await connected();

    ws.onmessage?.({ data: JSON.stringify({ type: "note:updated", payload: { id: "n1" } }) });
    expect(a).toHaveBeenCalledWith("note:updated", { id: "n1" });
    expect(b).toHaveBeenCalledWith("note:updated", { id: "n1" });

    offA();
    ws.onmessage?.({ data: JSON.stringify({ type: "note:deleted", payload: { id: "n2" } }) });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("ignores malformed messages", async () => {
    const handler = vi.fn();
    client.onMessage(handler);
    const ws = await connected();
    expect(() => ws.onmessage?.({ data: "{not json" })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("signs out and stops reconnecting when this device is revoked", async () => {
    const logout = vi.fn();
    window.addEventListener("nexus:logout", logout);
    const handler = vi.fn();
    client.onMessage(handler);
    const ws = await connected();

    ws.onmessage?.({ data: JSON.stringify({ type: "device:revoked", payload: null }) });
    expect(logout).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    expect(ws.closed).toBe(true);
    window.removeEventListener("nexus:logout", logout);
  });

  it("doubles the reconnect delay up to 30 s and resets it after a connect", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("down"));
    vi.stubGlobal("fetch", fetchMock);
    client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Waits of 1, 2, 4, 8, 16, 30, 30 s between attempts.
    const waits = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const [i, ms] of waits.entries()) {
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(fetchMock).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(i + 2);
    }

    // A successful connect starts over at 1 s.
    fetchMock.mockImplementation(() => Promise.resolve(ticketResponse("t-ok")));
    await vi.advanceTimersByTimeAsync(30000);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].onopen?.({});
    FakeWebSocket.instances[0].drop();
    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it("closes the socket on an error", async () => {
    vi.useFakeTimers();
    const ws = await connected();
    ws.onerror?.({});
    expect(ws.closed).toBe(true);
  });
});
