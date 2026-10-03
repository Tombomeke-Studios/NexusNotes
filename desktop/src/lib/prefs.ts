import { DEFAULT_DAILY_TEMPLATE } from "./templates";
import { MOTION_PREFERENCES, type MotionPreference } from "./motion";

export type ViewMode = "edit" | "split" | "preview";
export type RightTab = "outline" | "links" | "graph" | "files" | "info";

export interface WorkspacePrefs {
  fontSize: number;
  /** Reduced motion: follow the OS, always reduce, or keep full motion (lib/motion.ts). */
  motion: MotionPreference;
  showStatusBar: boolean;
  viewMode: ViewMode;
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
  rightWidth: number;
  splitPct: number;
  rightTab: RightTab;
  /** Markdown used for new daily notes; supports {{date}}, {{time}}, {{title}}. */
  dailyTemplate: string;
}

export const PREFS_STORAGE_KEY = "nexus_workspace_prefs";

export const DEFAULT_PREFS: WorkspacePrefs = {
  fontSize: 14,
  motion: "system",
  showStatusBar: true,
  viewMode: "split",
  leftOpen: true,
  rightOpen: true,
  leftWidth: 252,
  rightWidth: 288,
  splitPct: 52,
  rightTab: "outline",
  dailyTemplate: DEFAULT_DAILY_TEMPLATE,
};

export const PREF_LIMITS = {
  fontSize: [12, 20],
  leftWidth: [200, 380],
  rightWidth: [220, 400],
  splitPct: [25, 75],
} as const;

const VIEW_MODES: ViewMode[] = ["edit", "split", "preview"];
const RIGHT_TABS: RightTab[] = ["outline", "links", "graph", "files", "info"];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitize(raw: Partial<WorkspacePrefs> & { reduceMotion?: unknown }): WorkspacePrefs {
  const prefs = { ...DEFAULT_PREFS };
  for (const key of ["fontSize", "leftWidth", "rightWidth", "splitPct"] as const) {
    const v = raw[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      const [min, max] = PREF_LIMITS[key];
      prefs[key] = clamp(v, min, max);
    }
  }
  for (const key of ["showStatusBar", "leftOpen", "rightOpen"] as const) {
    const v = raw[key];
    if (typeof v === "boolean") prefs[key] = v;
  }
  if (MOTION_PREFERENCES.includes(raw.motion as MotionPreference)) {
    prefs.motion = raw.motion as MotionPreference;
  } else if (raw.reduceMotion === true) {
    // Legacy boolean toggle from before the OS preference was honoured.
    prefs.motion = "reduce";
  }
  if (VIEW_MODES.includes(raw.viewMode as ViewMode)) prefs.viewMode = raw.viewMode as ViewMode;
  if (RIGHT_TABS.includes(raw.rightTab as RightTab)) prefs.rightTab = raw.rightTab as RightTab;
  if (typeof raw.dailyTemplate === "string" && raw.dailyTemplate.trim()) {
    prefs.dailyTemplate = raw.dailyTemplate;
  }
  return prefs;
}

export function loadPrefs(): WorkspacePrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(partial: Partial<WorkspacePrefs>): WorkspacePrefs {
  const next = sanitize({ ...loadPrefs(), ...partial });
  localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  return next;
}
