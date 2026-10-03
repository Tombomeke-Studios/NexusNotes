import type { ReactNode } from "react";
import "./EmptyState.css";

type Art = "notes" | "graph" | "search";

/**
 * An empty view with a small illustration, a title, a line of guidance and
 * an optional action (#450): an empty vault, a graph without links, a search
 * without results. The illustrations are decorative and hidden from screen
 * readers; the text says what matters.
 */
export function EmptyState({
  art,
  title,
  children,
  action,
  secondary,
  compact = false,
}: {
  art: Art;
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}`}>
      <Illustration art={art} />
      <div className="empty-state-title">{title}</div>
      {children && <div className="empty-state-body">{children}</div>}
      {(action || secondary) && (
        <div className="empty-state-actions">
          {action && (
            <button className="empty-state-action" onClick={action.onClick}>
              {action.label}
            </button>
          )}
          {secondary && (
            <button className="empty-state-action empty-state-action--quiet" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Illustration({ art }: { art: Art }) {
  if (art === "notes") {
    return (
      <svg className="empty-state-art" width="88" height="72" viewBox="0 0 88 72" fill="none" aria-hidden="true">
        <rect x="26" y="8" width="40" height="52" rx="5" className="es-sheet es-sheet--back" transform="rotate(8 46 34)" />
        <rect x="20" y="10" width="40" height="52" rx="5" className="es-sheet" />
        <path d="M28 24h22M28 31h18M28 38h12" className="es-line" />
        <circle cx="62" cy="54" r="10" className="es-accent" />
        <path d="M62 49v10M57 54h10" className="es-accent-mark" />
      </svg>
    );
  }
  if (art === "graph") {
    return (
      <svg className="empty-state-art" width="96" height="72" viewBox="0 0 96 72" fill="none" aria-hidden="true">
        <path d="M30 36 48 22" className="es-edge es-edge--dashed" />
        <path d="M48 22 68 40" className="es-edge es-edge--dashed" />
        <circle cx="30" cy="36" r="8" className="es-node" />
        <circle cx="48" cy="22" r="6" className="es-node es-node--accent" />
        <circle cx="68" cy="40" r="7" className="es-node" />
        <circle cx="44" cy="56" r="5" className="es-node es-node--faint" />
      </svg>
    );
  }
  return (
    <svg className="empty-state-art" width="80" height="72" viewBox="0 0 80 72" fill="none" aria-hidden="true">
      <circle cx="35" cy="32" r="17" className="es-lens" />
      <path d="m48 45 13 13" className="es-handle" />
      <path d="M29 32h12" className="es-line" />
    </svg>
  );
}
