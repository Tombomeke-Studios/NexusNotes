import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AIAccessSettings, type McpTokenApi } from "./AIAccessSettings";
import { httpConfig, stdioConfig } from "../../lib/mcpConfig";
import type { McpToken } from "../../lib/types";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function fakeApi(tokens: McpToken[] = []): McpTokenApi & { revoked: string[] } {
  const revoked: string[] = [];
  return {
    revoked,
    list: vi.fn(async () => tokens),
    create: vi.fn(async (name, scope) => ({
      id: "t-new",
      name,
      scope,
      last_used_at: null,
      created_at: new Date().toISOString(),
      token: "nn_secretvalue",
    })),
    revoke: vi.fn(async (id: string) => {
      revoked.push(id);
    }),
    audit: vi.fn(async () => [
      { token_id: "t1", tool: "read_note", summary: "GET /api/notes/n1", created_at: minutesAgo(2) },
    ]),
  };
}

describe("AIAccessSettings", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });

  it("lists tokens with their access and last use, and the audit log", async () => {
    const api = fakeApi([
      { id: "t1", name: "Claude Desktop", scope: "read", last_used_at: minutesAgo(5), created_at: minutesAgo(90) },
      { id: "t2", name: "Cursor", scope: "read-write", last_used_at: null, created_at: minutesAgo(30) },
    ]);
    render(<AIAccessSettings api={api} />);
    const revoke = await screen.findByRole("button", { name: "Revoke Claude Desktop" });
    expect(revoke.closest(".settings-device")?.textContent).toContain("Read only");
    const cursor = screen.getByRole("button", { name: "Revoke Cursor" }).closest(".settings-device");
    expect(cursor?.textContent).toContain("Read and write");
    expect(cursor?.textContent).toContain("Never used");
    const log = await screen.findByRole("list", { name: "AI activity" });
    expect(within(log).getByText("read_note")).toBeTruthy();
    expect(within(log).getByText("Claude Desktop")).toBeTruthy();
  });

  it("shows a new token once, with config that contains it", async () => {
    const api = fakeApi();
    render(<AIAccessSettings api={api} />);
    await screen.findByText("No tokens yet.");
    fireEvent.change(screen.getByLabelText("Token name"), { target: { value: "Claude Desktop" } });
    fireEvent.change(screen.getByLabelText("Token access"), { target: { value: "read-write" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith("Claude Desktop", "read-write"));
    const notice = await screen.findByRole("status");
    expect(within(notice).getByText("nn_secretvalue")).toBeTruthy();
    expect(within(notice).getByText(/not shown again/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Copy MCP config" })[0]);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const copiedText = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(JSON.parse(copiedText).mcpServers.nexusnotes.env.NEXUSNOTES_TOKEN).toBe("nn_secretvalue");
  });

  it("revokes a token after confirming", async () => {
    const api = fakeApi([{ id: "t1", name: "Claude Desktop", scope: "read", last_used_at: null, created_at: minutesAgo(1) }]);
    render(<AIAccessSettings api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Claude Desktop" }));
    expect(api.revoked).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Revoke now" }));
    await waitFor(() => expect(api.revoked).toEqual(["t1"]));
    expect(await screen.findByText("No tokens yet.")).toBeTruthy();
  });

  it("reports a failed create", async () => {
    const api = fakeApi();
    api.create = vi.fn(async () => {
      throw new Error("409");
    });
    render(<AIAccessSettings api={api} />);
    fireEvent.change(await screen.findByLabelText("Token name"), { target: { value: "One too many" } });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/up to 20 tokens/);
  });
});

describe("MCP client config", () => {
  it("puts the token in env for stdio and in a header for HTTP", () => {
    const stdio = JSON.parse(stdioConfig("nn_x", "http://localhost:8080"));
    expect(stdio.mcpServers.nexusnotes).toEqual({
      command: "nexusnotes-mcp",
      env: { NEXUSNOTES_TOKEN: "nn_x", NEXUSNOTES_API_URL: "http://localhost:8080" },
    });
    const http = JSON.parse(httpConfig("nn_x", "https://notes.example.com/mcp"));
    expect(http.mcpServers.nexusnotes).toEqual({
      url: "https://notes.example.com/mcp",
      headers: { Authorization: "Bearer nn_x" },
    });
  });
});
