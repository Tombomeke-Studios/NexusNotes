import { useEffect, useState } from "react";
import { downloadFile } from "../../lib/export";
import { motion, useIsPresent } from "framer-motion";
import type { WorkspacePrefs } from "../../lib/prefs";
import type { Vault } from "../../lib/types";
import { auth, devices as devicesApi, ApiError } from "../../lib/api";
import type { Device } from "../../lib/types";
import { relativeTimeLabel } from "../../lib/stats";
import { APP_VERSION, formatVersionLabel } from "../../lib/version";
import { useServerStatus } from "../../lib/useServerStatus";
import { ChangePassphraseForm } from "../Encryption/ChangePassphraseForm";
import { ConvertVaultForm } from "../Encryption/ConvertVaultForm";
import type { MotionPreference } from "../../lib/motion";
import { spring } from "../../lib/motion-tokens";
import "./Settings.css";
import { OverlayMotion } from "../motion/OverlayMotion";

type SettingsTab = "appearance" | "sync" | "shortcuts" | "account";

interface SettingsProps {
  prefs: WorkspacePrefs;
  /** Whether the OS asks for reduced motion (what the "System" choice resolves to). */
  osReducedMotion: boolean;
  lastSyncLabel: string | null;
  /** The vault whose settings-relevant state (encryption) is shown. */
  activeVault: Vault | null;
  /** Re-wraps the active e2ee vault's key under a new passphrase (#199). */
  onChangePassphrase: (currentPassphrase: string, newPassphrase: string) => Promise<void>;
  /** Encrypts the active standard vault end to end with a new passphrase (#361). */
  onEncryptVault: (passphrase: string) => Promise<void>;
  /** Downloads the active vault as an Obsidian-compatible zip (#152). */
  onExportVault: () => void;
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
  ["Insert template", "Ctrl+T"],
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

const MOTION_OPTIONS: Array<{ value: MotionPreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "reduce", label: "Reduced" },
  { value: "full", label: "Full" },
];

/** Segmented choice with a pill that glides to the selected option. */
function Segmented<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            className={`settings-seg-btn${on ? " settings-seg-btn--on" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {on && <motion.span layoutId={`seg-pill-${id}`} className="settings-seg-pill" transition={spring.snappy} />}
            <span className="settings-seg-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Settings({
  prefs,
  osReducedMotion,
  lastSyncLabel,
  activeVault,
  onChangePassphrase,
  onEncryptVault,
  onExportVault,
  onUpdatePrefs,
  onSignOut,
  onClose,
}: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const serverStatus = useServerStatus();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Devices registered to the account (#44); loaded when Account opens.
  const [deviceList, setDeviceList] = useState<Device[] | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const currentDeviceId = localStorage.getItem("nexus_device_id");

  useEffect(() => {
    if (tab === "account" && deviceList === null) {
      devicesApi
        .list()
        .then(setDeviceList)
        .catch(() => setDeviceError("Could not load devices"));
    }
  }, [tab, deviceList]);

  const handleRevokeDevice = async (id: string) => {
    setDeviceError(null);
    try {
      await devicesApi.revoke(id);
      setDeviceList((prev) => prev?.filter((d) => d.id !== id) ?? prev);
    } catch {
      setDeviceError("Revoking the device failed. Please try again.");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await auth.exportAccount();
      downloadFile(`nexusnotes-export-${new Date().toISOString().slice(0, 10)}.zip`, "application/zip", blob);
    } catch {
      setExportError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await auth.deleteAccount(deletePassword);
      onSignOut();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setDeleteError("Wrong password — your account was not deleted.");
      } else {
        setDeleteError("Deleting the account failed. Please try again.");
      }
      setDeleting(false);
    }
  };

  const present = useIsPresent();
  useEffect(() => {
    // Once closing (exit animation), Escape belongs to whatever is underneath.
    if (!present) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [present, onClose]);

  return (
    <OverlayMotion preset="backdrop" className="settings-overlay" onClick={onClose}>
      <OverlayMotion preset="dialog" className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {(["appearance", "sync", "shortcuts", "account"] as SettingsTab[]).map((t) => (
            <button
              key={t}
              className={`settings-nav-item${tab === t ? " settings-nav-item--active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "appearance" ? "Appearance" : t === "sync" ? "Sync" : t === "shortcuts" ? "Shortcuts" : "Account"}
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
          <div className="settings-version">{formatVersionLabel(APP_VERSION, serverStatus)}</div>
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
                    <div className="settings-row-label">Motion</div>
                    <div className="settings-row-sub">
                      {prefs.motion === "system"
                        ? `Follows your system: ${osReducedMotion ? "reduced motion" : "full motion"}`
                        : prefs.motion === "reduce"
                          ? "Animations are turned off"
                          : "Full animations, even if your system asks for less"}
                    </div>
                  </div>
                  <Segmented
                    id="motion"
                    label="Motion"
                    value={prefs.motion}
                    options={MOTION_OPTIONS}
                    onChange={(motion) => onUpdatePrefs({ motion })}
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
                <div className="settings-row settings-row--stacked">
                  <div>
                    <div className="settings-row-label">Daily note template</div>
                    <div className="settings-row-sub">
                      Used by Ctrl+D. Supports {"{{date}}"}, {"{{time}}"} and {"{{title}}"}.
                    </div>
                  </div>
                  <textarea
                    className="settings-template-input"
                    rows={6}
                    spellCheck={false}
                    value={prefs.dailyTemplate}
                    onChange={(e) => onUpdatePrefs({ dailyTemplate: e.target.value })}
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
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Export vault</div>
                    <div className="settings-row-sub">
                      Download {activeVault ? `"${activeVault.name}"` : "the vault"} as a zip of
                      markdown files (Obsidian-compatible). Encrypted vaults export decrypted,
                      entirely on this device.
                    </div>
                  </div>
                  <button className="settings-export-btn" onClick={onExportVault} disabled={!activeVault}>
                    Export .zip
                  </button>
                </div>
                {activeVault?.encryption === "e2ee" && (
                  <>
                    <div className="settings-section-title settings-section-title--spaced">
                      Encryption — {activeVault.name}
                    </div>
                    <div className="settings-kv">
                      <span>Mode</span>
                      <span>End-to-end encrypted (zero-knowledge)</span>
                    </div>
                    <div className="settings-row">
                      <div>
                        <div className="settings-row-label">Vault passphrase</div>
                        <div className="settings-row-sub">
                          Re-wraps the vault key; notes stay encrypted as they are
                        </div>
                      </div>
                    </div>
                    <ChangePassphraseForm onChange={onChangePassphrase} />
                  </>
                )}
                {activeVault?.encryption === "none" && (activeVault.role ?? "owner") === "owner" && (
                  <>
                    <div className="settings-section-title settings-section-title--spaced">
                      Encryption — {activeVault.name}
                    </div>
                    <div className="settings-kv">
                      <span>Mode</span>
                      <span>Encrypted on the server, not end to end</span>
                    </div>
                    <div className="settings-row">
                      <div>
                        <div className="settings-row-label">End-to-end encryption</div>
                        <div className="settings-row-sub">
                          Lock this vault so only you can read it
                        </div>
                      </div>
                    </div>
                    <ConvertVaultForm vaultName={activeVault.name} onConvert={onEncryptVault} />
                  </>
                )}
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

            {tab === "account" && (
              <>
                <div className="settings-section-title">Account</div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">Export your data</div>
                    <div className="settings-row-sub">
                      Download every vault as markdown files plus account metadata (zip)
                    </div>
                  </div>
                  <button
                    className="settings-export-btn"
                    disabled={exporting}
                    onClick={handleExport}
                  >
                    {exporting ? "Preparing…" : "Export"}
                  </button>
                </div>
                {exportError && <div className="settings-danger-error">{exportError}</div>}

                <div className="settings-section-title settings-section-title--spaced">Devices</div>
                <div className="settings-row-sub settings-devices-sub">
                  Sync sessions registered to your account. Revoking disconnects the
                  device and signs it out.
                </div>
                {deviceError && <div className="settings-danger-error">{deviceError}</div>}
                {deviceList !== null && deviceList.length === 0 && (
                  <div className="settings-row-sub">No devices registered yet.</div>
                )}
                <div className="settings-devices">
                  {(deviceList ?? []).map((d) => (
                    <div key={d.id} className="settings-device">
                      <div className="settings-device-info">
                        <span className="settings-row-label">
                          {d.name || "Unnamed device"}
                          {d.id === currentDeviceId && (
                            <span className="settings-device-badge">This device</span>
                          )}
                        </span>
                        <span className="settings-row-sub">
                          {d.platform || "unknown"} · last seen {relativeTimeLabel(new Date(d.last_seen))}
                        </span>
                      </div>
                      <button
                        className="settings-danger-btn settings-device-revoke"
                        disabled={d.id === currentDeviceId}
                        title={d.id === currentDeviceId ? "You cannot revoke the device you are using" : "Disconnect and sign out this device"}
                        onClick={() => handleRevokeDevice(d.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>

                <div className="settings-danger-zone">
                  <div className="settings-row-label">Delete account</div>
                  <div className="settings-row-sub">
                    Permanently erases your account and every vault, note and version
                    on the server. This cannot be undone.
                  </div>
                  {!confirmingDelete ? (
                    <button
                      className="settings-danger-btn"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      Delete account…
                    </button>
                  ) : (
                    <div className="settings-danger-confirm">
                      <label className="settings-row-sub" htmlFor="delete-account-password">
                        Confirm with your password to delete everything:
                      </label>
                      <input
                        id="delete-account-password"
                        type="password"
                        className="settings-danger-input"
                        placeholder="Current password"
                        value={deletePassword}
                        autoFocus
                        onChange={(e) => {
                          setDeletePassword(e.target.value);
                          setDeleteError(null);
                        }}
                      />
                      {deleteError && <div className="settings-danger-error">{deleteError}</div>}
                      <div className="settings-danger-actions">
                        <button
                          className="settings-danger-cancel"
                          disabled={deleting}
                          onClick={() => {
                            setConfirmingDelete(false);
                            setDeletePassword("");
                            setDeleteError(null);
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          className="settings-danger-btn"
                          disabled={deletePassword.length === 0 || deleting}
                          onClick={handleDeleteAccount}
                        >
                          {deleting ? "Deleting…" : "Permanently delete"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </OverlayMotion>
    </OverlayMotion>
  );
}
