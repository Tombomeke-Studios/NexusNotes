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
  /** Toasts with the same key replace each other rather than stacking. */
  key?: string;
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
  { kind = "info", duration, key }: { kind?: ToastKind; duration?: number; key?: string } = {},
): number {
  const id = nextId++;
  const item: Toast = { id, message, kind, duration: duration ?? (kind === "error" ? 6000 : DEFAULT_DURATION), key };
  const rest = key ? toasts.filter((t) => t.key !== key) : toasts;
  set([...rest, item].slice(-MAX_TOASTS));
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
