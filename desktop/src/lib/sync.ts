import { getToken, setToken, getDeviceId, wsTickets } from "./api";
import { deviceDescription } from "./platform";

const WS_BASE = import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;

type MessageHandler = (type: string, payload: unknown) => void;

export class SyncClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private stopped = false;
  // Bumped by every connect() and disconnect(). Async work belonging to an
  // older generation (an in-flight ticket fetch, a stale socket's close
  // event) is dropped, so a quick disconnect/reconnect never ends up with two
  // sockets or a reconnect loop nobody asked for.
  private generation = 0;

  connect() {
    this.stopped = false;
    this.clearReconnectTimer();
    this.closeSocket();
    const generation = ++this.generation;
    if (!getToken()) return;
    void this.open(generation);
  }

  disconnect() {
    this.stopped = true;
    this.generation++;
    this.clearReconnectTimer();
    this.closeSocket();
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  private async open(generation: number) {
    let ticket: string;
    try {
      // A fresh single-use ticket for every attempt (#258): the access token
      // itself never goes into the URL, where proxies and logs could keep it.
      ({ ticket } = await wsTickets.issue());
    } catch {
      // Server unreachable or overloaded: back off and try again. A dead
      // session has already signed out (token cleared), which stops us here.
      if (this.isCurrent(generation) && getToken()) this.scheduleReconnect();
      return;
    }
    if (!this.isCurrent(generation)) return;

    const deviceId = getDeviceId();
    // The connect also registers this device server-side (#44).
    const device = deviceDescription();
    const url =
      `${WS_BASE}/ws?ticket=${encodeURIComponent(ticket)}&device_id=${encodeURIComponent(deviceId)}` +
      `&device_name=${encodeURIComponent(device.name)}&platform=${encodeURIComponent(device.platform)}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.isCurrent(generation)) this.reconnectDelay = 1000;
    };

    ws.onmessage = (event) => {
      if (!this.isCurrent(generation)) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "device:revoked") {
          // This device was revoked from another session (#45): sign out and
          // stop reconnecting instead of silently re-registering ourselves.
          this.disconnect();
          setToken(null);
          window.dispatchEvent(new CustomEvent("nexus:logout"));
          return;
        }
        this.handlers.forEach((h) => h(msg.type, msg.payload));
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (this.isCurrent(generation) && getToken()) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private isCurrent(generation: number) {
    return !this.stopped && generation === this.generation;
  }

  private closeSocket() {
    this.ws?.close();
    this.ws = null;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }
}

export const syncClient = new SyncClient();
