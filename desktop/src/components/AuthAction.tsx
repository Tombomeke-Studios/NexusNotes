import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { AuthBackground } from "./AuthBackground";
import { auth } from "../lib/api";
import type { AuthAction as Action } from "../lib/authAction";
import { passphraseError } from "../lib/passphrase";

interface AuthActionProps {
  action: Exclude<Action, null>;
  /** Return to the normal auth screen (clears the action URL). */
  onDone: () => void;
}

/**
 * Renders the email-link flows (#47/#48): confirming an email verification
 * token, or setting a new password from a reset token. Both live outside the
 * authenticated app since the user arrives from an email while signed out.
 */
export function AuthAction({ action, onDone }: AuthActionProps) {
  return (
    <div className="auth-container">
      <div className="auth-aurora" aria-hidden="true" />
      <AuthBackground />
      <div className="auth-card">
        <div className="auth-logo"><Logo size={40} variant="dark" /></div>
        <h1 className="auth-title">NexusNotes</h1>
        {action.kind === "verify-email" ? (
          <VerifyEmail token={action.token} onDone={onDone} />
        ) : (
          <ResetPassword token={action.token} onDone={onDone} />
        )}
      </div>
    </div>
  );
}

function VerifyEmail({ token, onDone }: { token: string; onDone: () => void }) {
  const [status, setStatus] = useState<"working" | "done" | "error">("working");

  useEffect(() => {
    auth
      .verifyEmail(token)
      .then(() => setStatus("done"))
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <>
      <p className="auth-subtitle">
        {status === "working" && "Verifying your email…"}
        {status === "done" && "Your email is verified 🎉"}
        {status === "error" && "This verification link is invalid or has expired."}
      </p>
      {status !== "working" && (
        <button className="auth-button" onClick={onDone}>
          Continue to sign in
        </button>
      )}
    </>
  );
}

function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passphraseError(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setLoading(true);
    try {
      await auth.resetPassword(token, password);
      setDone(true);
    } catch {
      setError("This reset link is invalid or has expired. Request a new one.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <>
        <p className="auth-subtitle">Your password has been reset. All other sessions were signed out.</p>
        <button className="auth-button" onClick={onDone}>
          Continue to sign in
        </button>
      </>
    );
  }

  return (
    <>
      <p className="auth-subtitle">Choose a new password</p>
      <form onSubmit={submit} className="auth-form">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="auth-input"
          required
          minLength={8}
          autoFocus
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          className="auth-input"
          required
        />
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="auth-button" disabled={loading}>
          {loading ? "Resetting…" : "Reset password"}
        </button>
      </form>
      <button className="auth-toggle" onClick={onDone}>
        Back to sign in
      </button>
    </>
  );
}
