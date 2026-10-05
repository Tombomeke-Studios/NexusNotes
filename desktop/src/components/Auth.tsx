import { openConsentPreferences } from "../lib/consent";
import { LegalLink } from "./LegalLink";
import { ConsentBanner } from "./ConsentBanner";
import { useRef, useState } from "react";
import { Logo } from "./Logo";
import { AuthBackground } from "./AuthBackground";
import { WindowControls } from "./Workspace/WindowControls";
import { isTauriWindow } from "../lib/platform";
import { auth, API_URL, isNetworkError } from "../lib/api";
import { unreachableMessage } from "../lib/connection";
import { ConnectionBanner } from "./ConnectionBanner";
import type { User } from "../lib/types";

interface AuthProps {
  onAuth: (user: User) => void;
  /** Reduced motion is on (lib/motion.ts): keep the background still. */
  reducedMotion?: boolean;
}

export function Auth({ onAuth, reducedMotion = false }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  // An email-link flow instead of the sign-in form: a password reset, or a
  // deletion request for an account the user can no longer sign in to (#289).
  const [emailFlow, setEmailFlow] = useState<null | "reset" | "delete">(null);
  const forgot = emailFlow !== null;
  const setForgot = (on: boolean) => setEmailFlow(on ? "reset" : null);
  const [forgotSent, setForgotSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  // "I agree to the Terms of Service and Privacy Policy" (#289).
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const glowRef = useRef<HTMLDivElement>(null);

  // Track the pointer for the background: the cursor-following glow (--mx/--my
  // in px) and a subtle parallax that nudges the aurora (--px/--py, -0.5..0.5).
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (glowRef.current) {
      glowRef.current.style.setProperty("--mx", `${x}px`);
      glowRef.current.style.setProperty("--my", `${y}px`);
    }
    e.currentTarget.style.setProperty("--px", `${x / rect.width - 0.5}`);
    e.currentTarget.style.setProperty("--py", `${y / rect.height - 0.5}`);
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (emailFlow === "delete") await auth.requestDeletion(email);
      else await auth.forgotPassword(email);
      // Always confirm regardless of whether the address exists (no enumeration).
      setForgotSent(true);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? `${unreachableMessage(API_URL)} Please try again in a moment.`
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        const { user } = await auth.login(email, password);
        onAuth(user);
      } else {
        const { user } = await auth.register(email, password, displayName);
        onAuth(user);
      }
    } catch (err) {
      // A network failure (server unreachable) throws a TypeError from fetch.
      // Call that out clearly; genuine API errors (wrong password, email taken)
      // keep their own message; anything else falls back to a calm generic.
      const message =
        err instanceof TypeError
          ? "The server is currently unavailable. Please try again in a moment."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container" onPointerMove={handlePointerMove}>
      <div className="auth-aurora" aria-hidden="true" />
      <AuthBackground still={reducedMotion} />
      <div className="auth-cursor-glow" ref={glowRef} aria-hidden="true" />
      <ConnectionBanner />
      <div className="auth-titlebar" data-tauri-drag-region>
        {isTauriWindow && <WindowControls />}
      </div>
      <div className="auth-card">
        <div className="auth-logo"><Logo size={40} variant="dark" /></div>
        <h1 className="auth-title">NexusNotes</h1>
        <p className="auth-subtitle">
          {forgot
            ? emailFlow === "delete"
              ? "Delete your account"
              : "Reset your password"
            : isLogin
              ? "Welcome back to your second brain"
              : "Create your account"}
        </p>

        {forgot ? (
          forgotSent ? (
            <>
              <p className="auth-subtitle">
                {emailFlow === "delete"
                  ? "If an account exists for that address, we've sent a link to confirm the deletion. Check your inbox."
                  : "If an account exists for that address, a reset link is on its way. Check your inbox."}
              </p>
              <button
                className="auth-toggle"
                onClick={() => {
                  setForgot(false);
                  setForgotSent(false);
                  setError("");
                }}
              >
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <form onSubmit={handleForgot} className="auth-form">
                {emailFlow === "delete" && (
                  <p className="auth-hint">
                    Can&rsquo;t sign in? Enter your account&rsquo;s email. We&rsquo;ll send a link to confirm; the account
                    and all its notes are then deleted after 7 days unless you cancel.
                  </p>
                )}
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="auth-input"
                  required
                  autoFocus
                />
                {error && <div className="auth-error">{error}</div>}
                <button type="submit" className="auth-button" disabled={loading}>
                  {loading ? "Sending…" : emailFlow === "delete" ? "Send confirmation link" : "Send reset link"}
                </button>
              </form>
              <button
                className="auth-toggle"
                onClick={() => {
                  setForgot(false);
                  setError("");
                }}
              >
                Back to sign in
              </button>
            </>
          )
        ) : (
        <form onSubmit={handleSubmit} className="auth-form">
          {!isLogin && (
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              className="auth-input"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="auth-input"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="auth-input"
            required
            minLength={8}
          />

          {!isLogin && (
            <label className="auth-consent">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
              <span>
                I agree to the{" "}
                <LegalLink href="/legal/terms.html">Terms of Service</LegalLink>{" "}
                and{" "}
                <LegalLink href="/legal/privacy.html">Privacy Policy</LegalLink>
              </span>
            </label>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? (
              <span className="auth-button-loading">
                <span className="spinner spinner--sm" style={{ borderTopColor: "var(--bg-primary)" }} />
                {isLogin ? "Signing in…" : "Creating account…"}
              </span>
            ) : isLogin ? "Sign in" : "Create account"}
          </button>
        </form>
        )}

        {!forgot && (
          <button
            className="auth-toggle"
            onClick={() => {
              setIsLogin(!isLogin);
              setError("");
            }}
          >
            {isLogin ? "No account? Sign up" : "Have an account? Sign in"}
          </button>
        )}

        {!forgot && isLogin && (
          <button
            className="auth-forgot-link"
            onClick={() => {
              setForgot(true);
              setError("");
            }}
          >
            Forgot password?
          </button>
        )}

        {!forgot && isLogin && (
          <button
            className="auth-forgot-link auth-forgot-link--quiet"
            onClick={() => {
              setEmailFlow("delete");
              setError("");
            }}
          >
            Locked out? Request account deletion
          </button>
        )}

        <div className="auth-footer">
          <span className="auth-footer-dot" />
          Self-hosted &middot; end-to-end encrypted sync
        </div>
        <ConsentBanner />
        <nav className="auth-legal" aria-label="Legal">
          <LegalLink href="/legal/privacy.html">Privacy</LegalLink>
          <LegalLink href="/legal/terms.html">Terms</LegalLink>
          <button type="button" onClick={openConsentPreferences}>Cookie preferences</button>
        </nav>
      </div>
    </div>
  );
}
