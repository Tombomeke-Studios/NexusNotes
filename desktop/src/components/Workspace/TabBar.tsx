import "./Workspace.css";

export interface WorkspaceTab {
  key: string;
  type: "note" | "graph";
  title: string;
}

interface TabBarProps {
  tabs: WorkspaceTab[];
  activeKey: string | null;
  /** Tab key with unsaved changes (shows a dirty dot). */
  unsavedKey?: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
}

export function TabBar({ tabs, activeKey, unsavedKey, onSelect, onClose, onNew }: TabBarProps) {
  return (
    <div className="tabbar">
      {tabs.map((tab) => (
        <div
          key={tab.key}
          className={`tab${tab.key === activeKey ? " tab--active" : ""}${tab.key === unsavedKey ? " tab--unsaved" : ""}`}
          onClick={() => onSelect(tab.key)}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(tab.key);
            }
          }}
        >
          {tab.type === "graph" ? (
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" className="tab-icon">
              <circle cx="5" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="15" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="15" cy="15" r="2.4" stroke="currentColor" strokeWidth="1.6" />
              <path d="M7.2 9L12.8 6M7.2 11l5.6 3" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="tab-icon">
              <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <span className="tab-title">{tab.title || "Untitled"}</span>
          <span className="tab-dot" title="Unsaved changes" />
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.key);
            }}
            title="Close tab"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} title="New note (Ctrl+N)">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
