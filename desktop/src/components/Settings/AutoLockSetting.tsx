import { AUTO_LOCK_CHOICES, type AutoLockMinutes } from "../../lib/prefs";
import { Segmented } from "./Segmented";

const OPTIONS = AUTO_LOCK_CHOICES.map((m) => ({ value: String(m), label: m === 0 ? "Off" : `${m} min` }));

/**
 * Settings row for auto-locking encrypted vaults when the app is idle (#545).
 * Applies to every unlocked end-to-end encrypted vault on this device.
 */
export function AutoLockSetting({
  value,
  onChange,
}: {
  value: AutoLockMinutes;
  onChange: (minutes: AutoLockMinutes) => void;
}) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">Auto-lock</div>
        <div className="settings-row-sub">
          {value === 0
            ? "Encrypted vaults stay unlocked until you lock them or close the app"
            : `Encrypted vaults lock after ${value} minutes without keyboard or mouse activity`}
        </div>
      </div>
      <Segmented
        id="auto-lock"
        label="Auto-lock"
        value={String(value)}
        options={OPTIONS}
        onChange={(v) => onChange(Number(v) as AutoLockMinutes)}
      />
    </div>
  );
}
