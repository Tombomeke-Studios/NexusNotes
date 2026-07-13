import { getToken, setToken, getDeviceId } from "./api";
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

  connect() {
    this.stopped = false;
    const token = getToken();
    if (!token) return;

    const deviceId = getDeviceId();
    // The connect also registers this device server-side (#44).
    const device = deviceDescription();
    const url =
      `${WS_BASE}/ws?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(deviceId)}` +
      `&device_name=${encodeURIComponent(device.name)}&platform=${encodeURIComponent(device.platform)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (event) => {
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

    this.ws.onclose = () => {
      if (!this.stopped && getToken()) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }
}

export const syncClient = new SyncClient();
