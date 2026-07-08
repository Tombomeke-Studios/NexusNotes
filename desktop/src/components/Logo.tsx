interface LogoProps {
  size?: number;
  /**
   * tile: gradient nodes on a dark rounded tile (default, sidebar/app icon)
   * dark: dark nodes with float/pulse animation, for the bright gradient tile
   *   on the auth card
   * animated: gradient nodes with float/pulse animation, no tile (top bar)
   */
  variant?: "tile" | "dark" | "animated";
}

// Per-node float animation, shared by the animated variants. Reuses the
// nodeFloat / nodeFloatB keyframes in index.css (transform/opacity only).
const float = (delay: string, down = false) => ({
  transformBox: "fill-box" as const,
  transformOrigin: "center",
  animation: `${down ? "nodeFloatB" : "nodeFloat"} 3.4s ease-in-out infinite ${delay}`,
});

const corePulse = {
  transformBox: "fill-box" as const,
  transformOrigin: "center",
  animation: "corePulse 3.4s ease-in-out infinite",
};

export function Logo({ size = 28, variant = "tile" }: LogoProps) {
  if (variant === "dark") {
    // Dark nodes on the bright gradient tile, animated in place so the auth
    // logo has the same life as the top-bar mark.
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
        <g
          stroke="#11111b"
          strokeWidth="1.6"
          opacity="0.5"
          strokeLinecap="round"
          style={{ animation: "linkShimmer 3.4s ease-in-out infinite" }}
        >
          <line x1="10" y1="8" x2="10" y2="24" />
          <line x1="10" y1="8" x2="22" y2="24" />
          <line x1="22" y1="8" x2="22" y2="24" />
        </g>
        <circle cx="10" cy="8" r="3" fill="#11111b" style={float("0s")} />
        <circle cx="10" cy="24" r="3" fill="#11111b" style={float("0.4s", true)} />
        <circle cx="22" cy="8" r="3" fill="#11111b" style={float("0.9s", true)} />
        <circle cx="22" cy="24" r="3" fill="#11111b" style={float("1.3s")} />
        <circle cx="16" cy="16" r="3.5" fill="#11111b" style={corePulse} />
        <circle cx="16" cy="16" r="1.4" fill="#cba6f7" style={corePulse} />
      </svg>
    );
  }

  if (variant === "animated") {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: "visible" }}>
        <g
          stroke="#cba6f7"
          strokeWidth="1.8"
          strokeLinecap="round"
          style={{ animation: "linkShimmer 3.4s ease-in-out infinite" }}
        >
          <line x1="10" y1="8" x2="10" y2="24" />
          <line x1="10" y1="8" x2="22" y2="24" />
          <line x1="22" y1="8" x2="22" y2="24" />
        </g>
        <circle cx="10" cy="8" r="3.2" fill="#cba6f7" style={float("0s")} />
        <circle cx="10" cy="24" r="3.2" fill="#b4befe" style={float("0.4s", true)} />
        <circle cx="22" cy="8" r="3.2" fill="#b4befe" style={float("0.9s", true)} />
        <circle cx="22" cy="24" r="3.2" fill="#b4befe" style={float("1.3s")} />
        <circle
          cx="16"
          cy="16"
          r="3.6"
          fill="#cba6f7"
          style={{ transformBox: "fill-box", transformOrigin: "center", animation: "corePulse 3.4s ease-in-out infinite" }}
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logo-g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#cba6f7" />
          <stop offset="100%" stopColor="#b4befe" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="6" fill="var(--bg-surface, #313244)" />
      <g stroke="url(#logo-g)" strokeWidth="1.5" opacity="0.4" strokeLinecap="round">
        <line x1="10" y1="8" x2="10" y2="24" />
        <line x1="10" y1="8" x2="22" y2="24" />
        <line x1="22" y1="8" x2="22" y2="24" />
      </g>
      <circle cx="10" cy="8" r="3" fill="url(#logo-g)" />
      <circle cx="10" cy="24" r="3" fill="url(#logo-g)" />
      <circle cx="22" cy="8" r="3" fill="url(#logo-g)" />
      <circle cx="22" cy="24" r="3" fill="url(#logo-g)" />
      <circle cx="16" cy="16" r="3.5" fill="url(#logo-g)" />
      <circle cx="16" cy="16" r="1.5" fill="var(--bg-surface, #313244)" />
    </svg>
  );
}
