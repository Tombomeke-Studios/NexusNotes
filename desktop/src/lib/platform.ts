/** True when running inside the native Tauri shell (not a plain browser). */
export const isTauriWindow =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
