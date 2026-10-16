import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, setToken, trash } from "./api";

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: "status",
    headers: new Headers(),
    json: () => (body !== undefined ? Promise.resolve(body) : Promise.reject(new Error("no body"))),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("trash client (#569)", () => {
  beforeEach(() => setToken("session-token"));
  afterEach(() => {
    setToken(null);
    vi.unstubAllGlobals();
  });

  it("moves one note to the trash with POST /api/notes/{id}/trash", async () => {
    const fetchMock = mockFetch(200, { id: "n1" });
    await trash.move("n1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/notes\/n1\/trash$/);
    expect(init.method).toBe("POST");
  });

  it("moves several notes in one batch call with their ids", async () => {
    const fetchMock = mockFetch(200, [{ id: "a" }]);
    const moved = await trash.moveMany("v1", ["a", "b"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/vaults\/v1\/trash$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ note_ids: ["a", "b"] });
    expect(moved).toEqual([{ id: "a" }]);
  });

  it("lists a vault's trash, treating a null body as empty", async () => {
    const fetchMock = mockFetch(200, null);
    expect(await trash.list("v1")).toEqual([]);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/vaults\/v1\/trash$/);
  });

  it("restores a note and returns it", async () => {
    const fetchMock = mockFetch(200, { id: "n1", title: "Plan" });
    expect(await trash.restore("n1")).toEqual({ id: "n1", title: "Plan" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/notes\/n1\/restore$/);
    expect(init.method).toBe("POST");
  });

  it("purges a trashed note with DELETE /api/notes/{id}/purge", async () => {
    const fetchMock = mockFetch(204);
    await trash.purge("n1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/notes\/n1\/purge$/);
    expect(init.method).toBe("DELETE");
  });

  it("empties a vault's trash and reports how many were purged", async () => {
    const fetchMock = mockFetch(200, { purged: 3 });
    expect(await trash.empty("v1")).toEqual({ purged: 3 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/vaults\/v1\/trash\/empty$/);
    expect(init.method).toBe("POST");
  });

  it("rejects with the server's status", async () => {
    mockFetch(403, { error: "forbidden" });
    await expect(trash.purge("n1")).rejects.toBeInstanceOf(ApiError);
    await expect(trash.purge("n1")).rejects.toMatchObject({ status: 403 });
  });
});
