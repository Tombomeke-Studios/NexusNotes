import { describe, it, expect, vi, afterEach } from "vitest";
import { notes, NOTES_PAGE_SIZE } from "./api";

afterEach(() => vi.unstubAllGlobals());

// The note list is fetched in pages (#461).
describe("notes.list paging", () => {
  it("follows X-Next-Cursor until the last page", async () => {
    const pages: Record<string, { body: unknown[]; next?: string }> = {
      "": { body: [{ id: "a" }, { id: "b" }], next: "c1" },
      c1: { body: [{ id: "c" }], next: "c2" },
      c2: { body: [] },
    };
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const after = new URL(url, "http://x").searchParams.get("after") ?? "";
        const page = pages[after];
        return new Response(JSON.stringify(page.body), {
          status: 200,
          headers: page.next ? { "X-Next-Cursor": page.next } : {},
        });
      }),
    );
    const list = await notes.list("v1");
    expect(list.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain(`limit=${NOTES_PAGE_SIZE}`);
    expect(urls[1]).toContain("after=c1");
  });
});
