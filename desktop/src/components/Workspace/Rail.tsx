import "./Workspace.css";

export type RailView = "files" | "search";

interface RailProps {
  activeView: RailView | null;
  graphActive: boolean;
  calendarOpen?: boolean;
  onFiles: () => void;
  onSearch?: () => void;
  onGraph: () => void;
  onDaily?: () => void;
  onSettings?: () => void;
}

export function Rail({
  activeView,
  graphActive,
  calendarOpen = false,
  onFiles,
  onSearch,
  onGraph,
  onDaily,
  onSettings,
}: RailProps) {
  return (
    <div className="rail">
      <button
        className={`rail-btn${activeView === "files" ? " rail-btn--active" : ""}`}
        onClick={onFiles}
        title="Files"
      >
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
          <path
            d="M2.5 5.5A1.5 1.5 0 014 4h3.4a1.5 1.5 0 011.2.6l.9 1.15a1.5 1.5 0 001.18.58H16a1.5 1.5 0 011.5 1.5V15a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 15V5.5z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {onSearch && (
        <button
          className={`rail-btn${activeView === "search" ? " rail-btn--active" : ""}`}
          onClick={onSearch}
          title="Search"
        >
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13.2 13.2L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <button
        className={`rail-btn${graphActive ? " rail-btn--active" : ""}`}
        onClick={onGraph}
        title="Graph (Ctrl+G)"
      >
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
          <circle cx="5" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="15" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="15" cy="15" r="2.4" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7.2 9L12.8 6M7.2 11l5.6 3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {onDaily && (
        <button
          className={`rail-btn${calendarOpen ? " rail-btn--active" : ""}`}
          onClick={onDaily}
          title="Daily notes (Ctrl+D)"
        >
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
            <rect x="3" y="4" width="14" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3 8h14" stroke="currentColor" strokeWidth="1.4" />
            <path d="M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="10" cy="12.5" r="1.6" fill="currentColor" />
          </svg>
        </button>
      )}
      <div className="rail-spacer" />
      {onSettings && (
        <button className="rail-btn rail-btn--settings" onClick={onSettings} title="Settings (Ctrl+,)">
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M10 2.2v2.2M10 15.6v2.2M2.2 10h2.2M15.6 10h2.2M4.5 4.5l1.55 1.55M13.95 13.95l1.55 1.55M15.5 4.5l-1.55 1.55M6.05 13.95L4.5 15.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
