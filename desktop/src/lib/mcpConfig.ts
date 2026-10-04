// Ready-to-paste MCP client configuration for NexusNotes (#221; docs/mcp.md).

/** claude_desktop_config.json entry for the stdio server. */
export function stdioConfig(token: string, apiUrl: string): string {
  return JSON.stringify(
    { mcpServers: { nexusnotes: { command: "nexusnotes-mcp", env: { NEXUSNOTES_TOKEN: token, NEXUSNOTES_API_URL: apiUrl } } } },
    null,
    2,
  );
}

/** Config for clients that speak Streamable HTTP (Cursor and others). */
export function httpConfig(token: string, mcpUrl: string): string {
  return JSON.stringify(
    { mcpServers: { nexusnotes: { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}
