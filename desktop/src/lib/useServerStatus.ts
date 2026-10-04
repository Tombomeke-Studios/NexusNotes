import { useEffect, useState } from "react";
import { server } from "./api";
import { SERVER_REACHABLE_EVENT, SERVER_SUSPECT_EVENT } from "./connection";
import type { ServerStatus } from "./version";

const POLL_OK_MS = 30_000;
const POLL_DOWN_MS = 4_000;

/** Polls the server: gently while healthy, quickly while it is down so recovery is noticed fast. */
export function useServerStatus(): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let wasDown = false;
    let inFlight = false;
    const tick = async () => {
      inFlight = true;
      const next = await server.status();
      inFlight = false;
      if (cancelled) return;
      setStatus(next);
      // Back from an outage: tell the app, so waiting saves go now (#333).
      const down = next.state === "unreachable";
      if (wasDown && !down) window.dispatchEvent(new CustomEvent(SERVER_REACHABLE_EVENT));
      wasDown = down;
      timer = setTimeout(tick, next.state === "unreachable" ? POLL_DOWN_MS : POLL_OK_MS);
    };
    // A failed request hints at an outage: check now instead of waiting out the
    // healthy-state interval. Skipped while already polling at the fast rate.
    const onSuspect = () => {
      if (wasDown || inFlight || cancelled) return;
      clearTimeout(timer);
      void tick();
    };
    window.addEventListener(SERVER_SUSPECT_EVENT, onSuspect);
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener(SERVER_SUSPECT_EVENT, onSuspect);
    };
  }, []);

  return status;
}
