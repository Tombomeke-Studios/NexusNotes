import { useEffect, useState } from "react";
import type { WorkspacePrefs } from "../../lib/prefs";
import "./Settings.css";

type SettingsTab = "appearance" | "sync" | "shortcuts";

interface SettingsProps {
  prefs: WorkspacePrefs;
  lastSyncLabel: string | null;
  onUpdatePrefs: (partial: Partial<WorkspacePrefs>) => void;
  onSignOut: () => void;
  onClose: () => void;
}

const SHORTCUTS: Array<[string, string]> = [
  ["Quick open", "Ctrl+P"],
  ["Command palette", "Ctrl+Shift+P"],
  ["New note", "Ctrl+N"],
  ["Open graph", "Ctrl+G"],
  ["Daily note", "Ctrl+D"],
  ["Cycle view", "Ctrl+E"],
  ["Global search", "Ctrl+Shift+F"],
  ["Save", "Ctrl+S"],
  ["Toggle sidebar", "Ctrl+B"],
  ["Toggle side panel", "Ctrl+."],
  ["Settings", "Ctrl+,"],
];

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button className={`settings-toggle${on ? " settings-toggle--on" : ""}`} onClick={onToggle}>
      <span className="settings-toggle-knob" />
    </button>
  );
}

export function Settings({ prefs, lastSyncLabel, onUpdatePrefs, onSignOut, onClose }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>("appearance");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {(["appearance", "sync", "shortcuts"] as SettingsTab[]).map((t) => (
            <button
              key={t}
              className={`settings-nav-item${tab === t ? " settings-nav-item--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "appearance" ? "Appearance" : t === "sync" ? "Sync" : "Shortcuts"}
            </button>
          ))}
          <div className="settings-nav-spacer" />
          <button className="settings-signout" onClick={onSignOut}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 14H3.5A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign out
          </button>
          <div className="settings-version">NexusNotes 0.1.0</div>
        </div>
        <div className="settings-content">
          <div className="settings-content-head">
            <button className="settings-close" onClick={onClose} title="Close">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="settings-body">
            {tab === "appearance" && (
              <>
                <div className="settings-section-title">Appearance</div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Editor font size</div>
                    <div className="settings-row-sub">Applies to editor and preview</div>
                  </div>
                  <div className="settings-row-control">
                    <input
                      type="range"
                      min={12}
                      max={20}
                      step={1}
                      value={prefs.fontSize}
                      onChange={(e) => onUpdatePrefs({ fontSize: Number(e.target.value) })}
                    />
                    <span className="settings-mono">{prefs.fontSize}px</span>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Reduce motion</div>
                    <div className="settings-row-sub">Minimize animations across the app</div>
                  </div>
                  <Toggle
                    on={prefs.reduceMotion}
                    onToggle={() => onUpdatePrefs({ reduceMotion: !prefs.reduceMotion })}
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Show status bar</div>
                    <div className="settings-row-sub">Word count, cursor position, sync state</div>
                  </div>
                  <Toggle
                    on={prefs.showStatusBar}
                    onToggle={() => onUpdatePrefs({ showStatusBar: !prefs.showStatusBar })}
                  />
                </div>
              </>
            )}

            {tab === "sync" && (
              <>
                <div className="settings-section-title">Sync</div>
                <div className="settings-sync-card">
                  <span className="settings-sync-dot" />
                  <div className="settings-sync-info">
                    <div className="settings-row-label">Connected to sync server</div>
                    <div className="settings-row-sub settings-mono">
                      {lastSyncLabel ? `last sync ${lastSyncLabel}` : "no sync yet this session"}
                    </div>
                  </div>
                </div>
                <div className="settings-kv">
                  <span>Conflict strategy</span>
                  <span>Checksum, last-writer-wins</span>
                </div>
                <div className="settings-kv">
                  <span>Transport</span>
                  <span>WebSocket + REST</span>
                </div>
                <div className="settings-kv">
                  <span>Storage</span>
                  <span>PostgreSQL, server-side</span>
                </div>
              </>
            )}

            {tab === "shortcuts" && (
              <>
                <div className="settings-section-title">Shortcuts</div>
                {SHORTCUTS.map(([label, keys]) => (
                  <div key={label} className="settings-kv">
                    <span>{label}</span>
                    <span className="settings-key">{keys}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
