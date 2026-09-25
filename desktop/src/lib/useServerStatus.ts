import { useEffect, useState } from "react";
import { server } from "./api";
import type { ServerStatus } from "./version";

const POLL_OK_MS = 30_000;
const POLL_DOWN_MS = 4_000;

/** Polls the server: gently while healthy, quickly while it is down so recovery is noticed fast. */
export function useServerStatus(): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const next = await server.status();
      if (cancelled) return;
      setStatus(next);
      timer = setTimeout(tick, next.state === "unreachable" ? POLL_DOWN_MS : POLL_OK_MS);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return status;
}
