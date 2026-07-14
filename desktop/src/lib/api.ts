import type { User, Vault, Note, NoteVersion, ConflictInfo, BacklinkNote, SearchHit, Device } from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "";

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem("nexus_token", token);
  } else {
    // Ending the session invalidates the refresh chain locally too.
    localStorage.removeItem("nexus_token");
    localStorage.removeItem("nexus_refresh");
  }
}

function setRefreshToken(token: string) {
  localStorage.setItem("nexus_refresh", token);
}

// Single-flight guard: concurrent 401s share one rotation instead of racing
// (a raced second rotation would trip the server's reuse detection).
let refreshInFlight: Promise<boolean> | null = null;

/** Rotates the refresh token into a fresh session; false when impossible. */
function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refresh = localStorage.getItem("nexus_refresh");
    if (!refresh) return false;
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh, device_id: getDeviceId() }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      setToken(body.token);
      setRefreshToken(body.refresh_token);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export function getToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem("nexus_token");
  }
  return authToken;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  { autoLogoutOn401 = true, isRetry = false }: { autoLogoutOn401?: boolean; isRetry?: boolean } = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401 && autoLogoutOn401) {
      // The access token may simply have aged out (1h TTL): rotate the
      // refresh token and replay the request once before giving up (#49).
      if (!isRetry && (await tryRefresh())) {
        return request<T>(path, options, { autoLogoutOn401, isRetry: true });
      }
      setToken(null);
      window.dispatchEvent(new CustomEvent("nexus:logout"));
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || "Request failed");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const auth = {
  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<{ user: User; token: string }> {
    const result = await request<{ user: User; token: string; refresh_token: string }>(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
          device_id: getDeviceId(),
        }),
      },
    );
    setToken(result.token);
    setRefreshToken(result.refresh_token);
    return result;
  },

  async login(
    email: string,
    password: string,
  ): Promise<{ user: User; token: string }> {
    const result = await request<{ user: User; token: string; refresh_token: string }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password, device_id: getDeviceId() }),
      },
    );
    setToken(result.token);
    setRefreshToken(result.refresh_token);
    return result;
  },

  logout() {
    // Best-effort server-side invalidation of the refresh chain.
    const refresh = localStorage.getItem("nexus_refresh");
    if (refresh) {
      fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      }).catch(() => {});
    }
    setToken(null);
  },

  /** GDPR data portability: download all vaults + metadata as a zip blob. */
  async exportAccount(): Promise<Blob> {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/auth/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new ApiError(res.status, "Export failed");
    }
    return res.blob();
  },

  /**
   * GDPR right to erasure. A wrong password comes back as a 401 that must NOT
   * trigger the global auto-logout — the user is still validly signed in and
   * just mistyped their confirmation.
   */
  async deleteAccount(password: string): Promise<void> {
    await request<void>(
      "/api/auth/account",
      { method: "DELETE", body: JSON.stringify({ password }) },
      { autoLogoutOn401: false },
    );
    setToken(null);
  },

  me: () => request<User>("/api/auth/me"),

  /** Confirms an email address from a verification link token (#47). */
  verifyEmail: (token: string) =>
    request<void>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  /**
   * Requests a password-reset email (#48). Always resolves, even for unknown
   * addresses, so the UI can't be used to probe which emails are registered.
   */
  forgotPassword: (email: string) =>
    request<void>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  /** Sets a new password from a reset-link token (#48). */
  resetPassword: (token: string, password: string) =>
    request<void>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
};

export const vaults = {
  list: () => request<Vault[]>("/api/vaults"),
  get: (id: string) => request<Vault>(`/api/vaults/${id}`),
  create: (name: string, encryption?: { encryption: "e2ee"; encryption_meta: unknown }) =>
    request<Vault>("/api/vaults", {
      method: "POST",
      body: JSON.stringify({ name, ...encryption }),
    }),
  update: (id: string, name: string) =>
    request<Vault>(`/api/vaults/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),
  /** Replaces the opaque key material (passphrase change / recovery rewrap). */
  updateEncryption: (id: string, encryptionMeta: unknown) =>
    request<void>(`/api/vaults/${id}/encryption`, {
      method: "PUT",
      body: JSON.stringify({ encryption_meta: encryptionMeta }),
    }),
  delete: (id: string) =>
    request<void>(`/api/vaults/${id}`, { method: "DELETE" }),
};

export const notes = {
  list: (vaultId: string) =>
    request<Note[]>(`/api/vaults/${vaultId}/notes`),
  get: (noteId: string) => request<Note>(`/api/notes/${noteId}`),
  // `checksum` is the client-computed plaintext SHA-256; only sent for e2ee
  // vaults (the server ignores it for standard vaults and hashes server-side).
  create: (vaultId: string, title: string, path: string, content: string, checksum?: string) =>
    request<Note>(`/api/vaults/${vaultId}/notes`, {
      method: "POST",
      body: JSON.stringify({
        title,
        path,
        content,
        device_id: getDeviceId(),
        ...(checksum ? { checksum } : {}),
      }),
    }),
  update: (
    noteId: string,
    title: string,
    path: string,
    content: string,
    prevChecksum: string,
    checksum?: string,
  ) =>
    request<Note | ConflictInfo>(`/api/notes/${noteId}`, {
      method: "PUT",
      body: JSON.stringify({
        title,
        path,
        content,
        prev_checksum: prevChecksum,
        device_id: getDeviceId(),
        ...(checksum ? { checksum } : {}),
      }),
    }),
  delete: (vaultId: string, noteId: string) =>
    request<void>(`/api/vaults/${vaultId}/notes/${noteId}`, {
      method: "DELETE",
    }),
  versions: (noteId: string) =>
    request<NoteVersion[]>(`/api/notes/${noteId}/versions`),
  backlinks: (noteId: string) =>
    request<BacklinkNote[]>(`/api/notes/${noteId}/backlinks`),
};

/** Starred (favourite) notes, per user across vaults (#151). */
export const stars = {
  list: () => request<string[]>("/api/notes/starred"),
  star: (noteId: string) =>
    request<void>(`/api/notes/${noteId}/star`, { method: "POST" }),
  unstar: (noteId: string) =>
    request<void>(`/api/notes/${noteId}/star`, { method: "DELETE" }),
};

/** Sync devices registered to the account (#44, #45). */
export const devices = {
  list: () => request<Device[]>("/api/devices"),
  revoke: (deviceId: string) =>
    request<void>(`/api/devices/${deviceId}`, { method: "DELETE" }),
};

export interface SearchParams {
  q?: string;
  tag?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export const search = {
  query: (vaultId: string, params: SearchParams) => {
    const qs = new URLSearchParams({ vault: vaultId });
    if (params.q) qs.set("q", params.q);
    if (params.tag) qs.set("tag", params.tag);
    if (params.date_from) qs.set("date_from", params.date_from);
    if (params.date_to) qs.set("date_to", params.date_to);
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.offset != null) qs.set("offset", String(params.offset));
    return request<SearchHit[]>(`/api/search?${qs.toString()}`);
  },
};

/** Stable per-installation device id, minted on first use. */
export function getDeviceId(): string {
  let id = localStorage.getItem("nexus_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("nexus_device_id", id);
  }
  return id;
}
