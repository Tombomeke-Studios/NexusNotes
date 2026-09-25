import { ApiError, isNetworkError } from "./api";

/**
 * What to do when restoring a stored session fails. Only an explicit rejection
 * of the session (401/403, or 404 = the account is gone) signs the user out;
 * an unreachable or failing server keeps the session and waits, so a slow
 * start or a database outage never logs anyone out.
 */
export function restoreFailureAction(err: unknown): "wait" | "sign-out" {
  if (isNetworkError(err)) return "wait";
  if (err instanceof ApiError) {
    return err.status === 401 || err.status === 403 || err.status === 404 ? "sign-out" : "wait";
  }
  return "sign-out";
}
