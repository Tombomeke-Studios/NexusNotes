import { useRef, useState } from "react";
import { Logo } from "./Logo";
import { AuthBackground } from "./AuthBackground";
import { WindowControls } from "./Workspace/WindowControls";
import { isTauriWindow } from "../lib/platform";
import { auth } from "../lib/api";
import type { User } from "../lib/types";

interface AuthProps {
  onAuth: (user: User) => void;
}

export function Auth({ onAuth }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [forgot, setForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
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
      await auth.forgotPassword(email);
      // Always confirm regardless of whether the address exists (no enumeration).
      setForgotSent(true);
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "The server is currently unavailable. Please try again in a moment."
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
      <AuthBackground />
      <div className="auth-cursor-glow" ref={glowRef} aria-hidden="true" />
      <div className="auth-titlebar" data-tauri-drag-region>
        {isTauriWindow && <WindowControls />}
      </div>
      <div className="auth-card">
        <div className="auth-logo"><Logo size={40} variant="dark" /></div>
        <h1 className="auth-title">NexusNotes</h1>
        <p className="auth-subtitle">
          {forgot
            ? "Reset your password"
            : isLogin
              ? "Welcome back to your second brain"
              : "Create your account"}
        </p>

        {forgot ? (
          forgotSent ? (
            <>
              <p className="auth-subtitle">
                If an account exists for that address, a reset link is on its way. Check your inbox.
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
                  {loading ? "Sending…" : "Send reset link"}
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

        <div className="auth-footer">
          <span className="auth-footer-dot" />
          Self-hosted &middot; end-to-end encrypted sync
        </div>
      </div>
    </div>
  );
}
