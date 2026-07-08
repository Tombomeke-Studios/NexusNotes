import { useRef, useState } from "react";
import { Logo } from "./Logo";
import { WindowControls } from "./Workspace/WindowControls";
import { isTauriWindow } from "../lib/platform";
import { auth } from "../lib/api";
import type { User } from "../lib/types";

interface AuthProps {
  onAuth: (user: User) => void;
}

export function Auth({ onAuth }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const glowRef = useRef<HTMLDivElement>(null);

  // Move the cursor-following glow by writing its position to CSS variables;
  // the CSS transition gives it a gentle lag as it trails the pointer.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = glowRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
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
      // Show a calm, non-technical message instead of the raw "Failed to fetch";
      // genuine API errors (wrong password, email taken) keep their own message.
      const message =
        err instanceof TypeError
          ? "Something went wrong. Please try again."
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
      <div className="auth-cursor-glow" ref={glowRef} aria-hidden="true" />
      <div className="auth-titlebar" data-tauri-drag-region>
        {isTauriWindow && <WindowControls />}
      </div>
      <div className="auth-card">
        <div className="auth-logo"><Logo size={40} variant="dark" /></div>
        <h1 className="auth-title">NexusNotes</h1>
        <p className="auth-subtitle">
          {isLogin ? "Welcome back to your second brain" : "Create your account"}
        </p>

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

        <button
          className="auth-toggle"
          onClick={() => {
            setIsLogin(!isLogin);
            setError("");
          }}
        >
          {isLogin ? "No account? Sign up" : "Have an account? Sign in"}
        </button>

        <div className="auth-footer">
          <span className="auth-footer-dot" />
          Self-hosted &middot; end-to-end encrypted sync
        </div>
      </div>
    </div>
  );
}
