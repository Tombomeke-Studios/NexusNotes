import { useEffect, useState } from "react";
import { isTauriWindow } from "./platform";

/**
 * True while the packaged app's supervisor reports that the server it found on
 * localhost:8080 is also reachable from the network (#336): it is not the
 * app's own loopback-only backend, so the user should know. Always false in a
 * browser.
 */
export function useBackendExposed(): boolean {
  const [exposed, setExposed] = useState(false);
  useEffect(() => {
    if (!isTauriWindow) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<boolean>("backend-exposed", (e) => setExposed(e.payload === true)))
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return exposed;
}
