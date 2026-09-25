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
