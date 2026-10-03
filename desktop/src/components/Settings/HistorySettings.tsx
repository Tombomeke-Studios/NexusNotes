import { useEffect, useState } from "react";
import { vaults as vaultsApi, type HistoryRetention } from "../../lib/api";

interface HistorySettingsProps {
  vault: { id: string; name: string; role?: string };
  load?: (vaultId: string) => Promise<HistoryRetention>;
  save?: (vaultId: string, keep: HistoryRetention) => Promise<unknown>;
}

const COUNTS = [10, 25, 50, 100, 200, 500];
const DAYS: Array<[number, string]> = [
  [0, "Never"],
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
  [365, "1 year"],
];

/**
 * How much version history the vault keeps (#418). Changing it trims the
 * history at once for everyone in the vault, so only the owner may.
 */
export function HistorySettings({
  vault,
  load = vaultsApi.historySettings,
  save = vaultsApi.setHistorySettings,
}: HistorySettingsProps) {
  const [keep, setKeep] = useState<HistoryRetention | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const isOwner = (vault.role ?? "owner") === "owner";

  useEffect(() => {
    let active = true;
    setKeep(null);
    load(vault.id)
      .then((k) => active && setKeep(k))
      .catch(() => active && setError("Couldn't load the history settings."));
    return () => {
      active = false;
    };
    // Reloaded per vault.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.id]);

  const change = async (next: HistoryRetention) => {
    if (!keep) return;
    const previous = keep;
    setKeep(next);
    setStatus("saving");
    setError(null);
    try {
      await save(vault.id, next);
      setStatus("saved");
    } catch {
      setKeep(previous);
      setStatus("idle");
      setError("Couldn't save the history settings. Try again.");
    }
  };

  // A stored value outside the presets stays selectable.
  const counts = keep && !COUNTS.includes(keep.keep_count) ? [...COUNTS, keep.keep_count].sort((a, b) => a - b) : COUNTS;
  const days = keep && !DAYS.some(([d]) => d === keep.keep_days) ? [...DAYS, [keep.keep_days, `${keep.keep_days} days`] as [number, string]].sort((a, b) => a[0] - b[0]) : DAYS;

  return (
    <>
      <div className="settings-section-title settings-section-title--spaced">Version history — {vault.name}</div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Versions kept per note</div>
          <div className="settings-row-sub">A version is saved every few minutes while you edit</div>
        </div>
        <select
          className="settings-select"
          aria-label="Versions kept per note"
          value={keep?.keep_count ?? ""}
          disabled={!keep || !isOwner}
          onChange={(e) => keep && change({ ...keep, keep_count: Number(e.target.value) })}
        >
          {counts.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Delete versions older than</div>
          <div className="settings-row-sub">The newest version of a note is always kept</div>
        </div>
        <select
          className="settings-select"
          aria-label="Delete versions older than"
          value={keep?.keep_days ?? ""}
          disabled={!keep || !isOwner}
          onChange={(e) => keep && change({ ...keep, keep_days: Number(e.target.value) })}
        >
          {days.map(([d, label]) => (
            <option key={d} value={d}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {!isOwner && <div className="settings-row-sub settings-history-note">Only the vault owner can change these.</div>}
      {status !== "idle" && !error && (
        <div className="settings-row-sub settings-history-note" role="status">
          {status === "saving" ? "Saving…" : "Saved"}
        </div>
      )}
      {error && (
        <div className="settings-history-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
