import { useEffect, useState } from "react";
import { mcpTokens, API_URL } from "../../lib/api";
import { isTauriWindow } from "../../lib/platform";
import { relativeTimeLabel } from "../../lib/stats";
import type { McpAuditEntry, McpScope, McpToken } from "../../lib/types";
import { httpConfig, stdioConfig } from "../../lib/mcpConfig";

/** The token calls this component makes; injectable for tests. */
export interface McpTokenApi {
  list: () => Promise<McpToken[]>;
  create: (name: string, scope: McpScope) => Promise<McpToken & { token: string }>;
  revoke: (id: string) => Promise<void>;
  audit: (limit?: number) => Promise<McpAuditEntry[]>;
}

const PLACEHOLDER = "nn_YOUR_TOKEN_HERE";

/**
 * The MCP endpoint of a self-hosted stack: the web UI proxies /mcp. The
 * packaged app has no such proxy, so there it is null and only the stdio
 * config is offered.
 */
function mcpHttpUrl(): string | null {
  if (isTauriWindow) return null;
  return `${window.location.origin}/mcp`;
}

/** Settings > AI Access (#221): MCP tokens, ready-to-paste client config and the audit log. */
export function AIAccessSettings({ api = mcpTokens }: { api?: McpTokenApi }) {
  const [tokens, setTokens] = useState<McpToken[] | null>(null);
  const [audit, setAudit] = useState<McpAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<McpScope>("read");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const httpUrl = mcpHttpUrl();

  useEffect(() => {
    let cancelled = false;
    api
      .list()
      .then((list) => !cancelled && setTokens(list))
      .catch(() => !cancelled && setError("Could not load your tokens."));
    api
      .audit(50)
      .then((entries) => !cancelled && setAudit(entries))
      .catch(() => !cancelled && setAudit([]));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      /* clipboard unavailable; the text is still selectable */
    }
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const { token, ...info } = await api.create(trimmed, scope);
      setTokens((prev) => [info, ...(prev ?? [])]);
      setCreated({ name: info.name, token });
      setName("");
    } catch {
      setError("Creating the token failed. You can hold up to 20 tokens.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setError(null);
    try {
      await api.revoke(id);
      setTokens((prev) => prev?.filter((t) => t.id !== id) ?? prev);
      setAudit((prev) => prev?.filter((e) => e.token_id !== id) ?? prev);
      setConfirmRevoke(null);
    } catch {
      setError("Revoking the token failed. Please try again.");
    }
  };

  const tokenName = (id: string) => tokens?.find((t) => t.id === id)?.name ?? "Revoked token";
  const shownToken = created?.token ?? PLACEHOLDER;

  return (
    <>
      <div className="settings-section-title">AI Access</div>
      <div className="settings-row-sub settings-devices-sub">
        Let Claude, Cursor and other MCP clients read and edit your notes with a token. A
        token acts as you in every vault you can open, except end-to-end encrypted vaults,
        which stay closed to it. Every call is recorded below.
      </div>

      <div className="settings-ai-create">
        <input
          className="settings-ai-input"
          placeholder="Token name, e.g. Claude Desktop"
          aria-label="Token name"
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleCreate();
          }}
        />
        <select
          className="settings-select"
          aria-label="Token access"
          value={scope}
          onChange={(e) => setScope(e.target.value as McpScope)}
        >
          <option value="read">Read only</option>
          <option value="read-write">Read and write</option>
        </select>
        <button className="settings-export-btn" disabled={creating || !name.trim()} onClick={() => void handleCreate()}>
          {creating ? "Creating…" : "Create token"}
        </button>
      </div>
      {error && (
        <div className="settings-danger-error" role="alert">
          {error}
        </div>
      )}

      {created && (
        <div className="settings-ai-created" role="status">
          <div className="settings-row-label">Token for {created.name}</div>
          <div className="settings-row-sub">Copy it now: it is not shown again.</div>
          <div className="settings-ai-secret">
            <code>{created.token}</code>
            <button className="settings-export-btn" onClick={() => void copy("token", created.token)}>
              {copied === "token" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="settings-section-title settings-section-title--spaced">Connect a client</div>
      <div className="settings-ai-configs">
        <div className="settings-ai-config">
          <div className="settings-row-label">Claude Desktop (stdio)</div>
          <div className="settings-row-sub">
            Add to <code>claude_desktop_config.json</code>. Needs the <code>nexusnotes-mcp</code> program on your PATH.
          </div>
          <pre className="settings-ai-snippet">{stdioConfig(shownToken, API_URL)}</pre>
          <button className="settings-export-btn" onClick={() => void copy("stdio", stdioConfig(shownToken, API_URL))}>
            {copied === "stdio" ? "Copied" : "Copy MCP config"}
          </button>
        </div>
        {httpUrl && (
          <div className="settings-ai-config">
            <div className="settings-row-label">Cursor and other HTTP clients</div>
            <div className="settings-row-sub">Streamable HTTP through this server.</div>
            <pre className="settings-ai-snippet">{httpConfig(shownToken, httpUrl)}</pre>
            <button className="settings-export-btn" onClick={() => void copy("http", httpConfig(shownToken, httpUrl))}>
              {copied === "http" ? "Copied" : "Copy MCP config"}
            </button>
          </div>
        )}
      </div>

      <div className="settings-section-title settings-section-title--spaced">Tokens</div>
      {tokens !== null && tokens.length === 0 && <div className="settings-row-sub">No tokens yet.</div>}
      <div className="settings-devices">
        {(tokens ?? []).map((t) => (
          <div key={t.id} className="settings-device">
            <div className="settings-device-info">
              <span className="settings-row-label">
                {t.name}
                <span className="settings-device-badge">{t.scope === "read" ? "Read only" : "Read and write"}</span>
              </span>
              <span className="settings-row-sub">
                {t.last_used_at ? `Last used ${relativeTimeLabel(new Date(t.last_used_at))}` : "Never used"} · created{" "}
                {relativeTimeLabel(new Date(t.created_at))}
              </span>
            </div>
            {confirmRevoke === t.id ? (
              <div className="settings-danger-actions">
                <button className="settings-danger-cancel" onClick={() => setConfirmRevoke(null)}>
                  Cancel
                </button>
                <button className="settings-danger-btn" onClick={() => void handleRevoke(t.id)}>
                  Revoke now
                </button>
              </div>
            ) : (
              <button
                className="settings-danger-btn settings-device-revoke"
                aria-label={`Revoke ${t.name}`}
                onClick={() => setConfirmRevoke(t.id)}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="settings-section-title settings-section-title--spaced">Recent activity</div>
      {audit !== null && audit.length === 0 && <div className="settings-row-sub">No AI activity yet.</div>}
      {audit !== null && audit.length > 0 && (
        <ul className="settings-ai-audit" aria-label="AI activity">
          {audit.map((e, i) => (
            <li key={`${e.created_at}-${i}`}>
              <span className="settings-ai-audit-time">{relativeTimeLabel(new Date(e.created_at))}</span>
              <span className="settings-ai-audit-token">{tokenName(e.token_id)}</span>
              <code>{e.tool}</code>
              <span className="settings-ai-audit-summary">{e.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
