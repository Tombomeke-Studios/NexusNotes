interface LogoProps {
  size?: number;
}

export function Logo({ size = 28 }: LogoProps) {
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
