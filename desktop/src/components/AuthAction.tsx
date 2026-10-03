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
        ) : action.kind === "reset-password" ? (
          <ResetPassword token={action.token} onDone={onDone} />
        ) : (
          <DeletionLink kind={action.kind} token={action.token} onDone={onDone} />
        )}
      </div>
    </div>
  );
}

/**
 * Account deletion links (#289): confirming a deletion asked for by email
 * (starts the 7-day grace period) or cancelling a scheduled one. Confirming
 * waits for a click, so a link scanner opening the URL can't start it.
 */
function DeletionLink({
  kind,
  token,
  onDone,
}: {
  kind: "confirm-deletion" | "cancel-deletion";
  token: string;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<"ask" | "working" | "done" | "error">(kind === "cancel-deletion" ? "working" : "ask");
  const [when, setWhen] = useState<string | null>(null);

  const confirm = () => {
    setStatus("working");
    auth
      .confirmDeletion(token)
      .then((r) => {
        setWhen(new Date(r.deletion_scheduled_at).toLocaleString());
        setStatus("done");
      })
      .catch(() => setStatus("error"));
  };

  useEffect(() => {
    if (kind !== "cancel-deletion") return;
    auth
      .cancelDeletion(token)
      .then(() => setStatus("done"))
      .catch(() => setStatus("error"));
  }, [kind, token]);

  if (kind === "cancel-deletion") {
    return (
      <>
        <p className="auth-subtitle">
          {status === "working" && "Keeping your account…"}
          {status === "done" && "Your account is safe: the deletion is cancelled."}
          {status === "error" && "This link is invalid, has expired or was already used."}
        </p>
        {status !== "working" && (
          <button className="auth-button" onClick={onDone}>
            Continue to sign in
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <p className="auth-subtitle">
        {status === "ask" &&
          "Delete your NexusNotes account and everything in it? It is erased after 7 days; until then the email we send lets you cancel."}
        {status === "working" && "Scheduling the deletion…"}
        {status === "done" && `Your account will be deleted on ${when}. We've emailed you a link to cancel.`}
        {status === "error" && "This link is invalid, has expired or was already used."}
      </p>
      {status === "ask" ? (
        <>
          <button className="auth-button auth-button--danger" onClick={confirm}>
            Delete my account
          </button>
          <button className="auth-toggle" onClick={onDone}>
            Keep it, take me to sign in
          </button>
        </>
      ) : (
        status !== "working" && (
          <button className="auth-button" onClick={onDone}>
            Back to sign in
          </button>
        )
      )}
    </>
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
