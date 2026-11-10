/**
 * Toast notifications (#429): short confirmations and errors that don't need
 * a dialog. A tiny external store, read by <Toaster> with
 * useSyncExternalStore, so anything (hooks, callbacks, libs) can call toast().
 */

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  /** Milliseconds on screen while not hovered or focused. */
  duration: number;
  /** A toast with the same key is updated in place (same id) rather than stacked. */
  key?: string;
  /** One button next to the message (e.g. "Open"); clicking it also closes the toast. */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export const MAX_TOASTS = 4;
const DEFAULT_DURATION = 3500;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

/** Shows a toast; returns its id for dismissToast. Errors stay a little longer. */
export function toast(
  message: string,
  {
    kind = "info",
    duration,
    key,
    action,
  }: { kind?: ToastKind; duration?: number; key?: string; action?: ToastAction } = {},
): number {
  // A toast with the same key is updated in place and keeps its id (#604):
  // one that was replaced by a new toast stayed on screen, fading, next to it.
  const existing = key ? toasts.find((t) => t.key === key) : undefined;
  const id = existing?.id ?? nextId++;
  const item: Toast = { id, message, kind, duration: duration ?? (kind === "error" ? 6000 : DEFAULT_DURATION), key };
  if (action) item.action = action;
  set(existing ? toasts.map((t) => (t === existing ? item : t)) : [...toasts, item].slice(-MAX_TOASTS));
  return id;
}

export function dismissToast(id: number) {
  if (toasts.some((t) => t.id === id)) set(toasts.filter((t) => t.id !== id));
}

export function clearToasts() {
  set([]);
}

export function getToasts(): Toast[] {
  return toasts;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
