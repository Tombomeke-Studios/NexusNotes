import type { User, Vault, Note, NoteVersion, ConflictInfo, BacklinkNote } from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "";

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem("nexus_token", token);
  } else {
    localStorage.removeItem("nexus_token");
  }
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
    if (res.status === 401) {
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
    const result = await request<{ user: User; token: string }>(
      "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
        }),
      },
    );
    setToken(result.token);
    return result;
  },

  async login(
    email: string,
    password: string,
  ): Promise<{ user: User; token: string }> {
    const result = await request<{ user: User; token: string }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );
    setToken(result.token);
    return result;
  },

  logout() {
    setToken(null);
  },

  me: () => request<User>("/api/auth/me"),
};

export const vaults = {
  list: () => request<Vault[]>("/api/vaults"),
  get: (id: string) => request<Vault>(`/api/vaults/${id}`),
  create: (name: string) =>
    request<Vault>("/api/vaults", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  update: (id: string, name: string) =>
    request<Vault>(`/api/vaults/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),
  delete: (id: string) =>
    request<void>(`/api/vaults/${id}`, { method: "DELETE" }),
};

export const notes = {
  list: (vaultId: string) =>
    request<Note[]>(`/api/vaults/${vaultId}/notes`),
  get: (noteId: string) => request<Note>(`/api/notes/${noteId}`),
  create: (vaultId: string, title: string, path: string, content: string) =>
    request<Note>(`/api/vaults/${vaultId}/notes`, {
      method: "POST",
      body: JSON.stringify({ title, path, content, device_id: getDeviceId() }),
    }),
  update: (
    noteId: string,
    title: string,
    path: string,
    content: string,
    prevChecksum: string,
  ) =>
    request<Note | ConflictInfo>(`/api/notes/${noteId}`, {
      method: "PUT",
      body: JSON.stringify({
        title,
        path,
        content,
        prev_checksum: prevChecksum,
        device_id: getDeviceId(),
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

function getDeviceId(): string {
  let id = localStorage.getItem("nexus_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("nexus_device_id", id);
  }
  return id;
}
