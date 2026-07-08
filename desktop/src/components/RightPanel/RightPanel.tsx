import { useMemo } from "react";
import type { Note } from "../../lib/types";
import type { RightTab } from "../../lib/prefs";
import { parseOutline } from "../../lib/outline";
import { buildBacklinkCards } from "../../lib/backlinks";
import { extractTags } from "../../lib/tags";
import { wordCount, readingTimeMinutes } from "../../lib/stats";
import { folderOf } from "../../lib/noteFilter";
import "./RightPanel.css";

interface RightPanelProps {
  note: Note | null;
  content: string;
  notes: Note[];
  tab: RightTab;
  onTabChange: (tab: RightTab) => void;
  onNavigateToNote: (noteId: string) => void;
  onTagClick: (tag: string) => void;
}

const TABS: RightTab[] = ["outline", "links", "info"];
const TAB_LABELS: Record<RightTab, string> = {
  outline: "Outline",
  links: "Links",
  info: "Info",
};

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/**
 * Scrolls the markdown preview pane to the index-th heading. DOM-based so
 * the panel stays decoupled from the editor component tree.
 */
function scrollPreviewToHeading(index: number) {
  const preview = document.querySelector(".editor-preview");
  if (!preview) return;
  const el = preview.querySelectorAll("h1, h2, h3, h4")[index];
  if (!el) return;
  preview.scrollTo({
    top:
      preview.scrollTop +
      (el.getBoundingClientRect().top - preview.getBoundingClientRect().top) -
      14,
    behavior: "smooth",
  });
}

export function RightPanel({
  note,
  content,
  notes,
  tab,
  onTabChange,
  onNavigateToNote,
  onTagClick,
}: RightPanelProps) {
  const outline = useMemo(() => (note ? parseOutline(content) : []), [note, content]);
  const backlinks = useMemo(
    () => (note ? buildBacklinkCards(notes, note) : []),
    [notes, note],
  );
  const tags = useMemo(() => (note ? extractTags(content) : []), [note, content]);
  const words = wordCount(content);

  return (
    <div className="right-panel">
      <div className="right-panel-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`right-panel-tab${tab === t ? " right-panel-tab--active" : ""}`}
            onClick={() => onTabChange(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <span
          className="right-panel-indicator"
          style={{ left: `${TABS.indexOf(tab) * 33.33}%` }}
        />
      </div>

      {tab === "outline" && (
        <div className="right-panel-body right-panel-body--outline">
          {outline.length === 0 && (
            <div className="right-panel-empty">No headings in this note</div>
          )}
          {outline.map((h) => (
            <button
              key={h.index}
              className={`outline-item${h.level === 1 ? " outline-item--top" : ""}`}
              style={{ paddingLeft: 8 + (h.level - 1) * 14 }}
              onClick={() => scrollPreviewToHeading(h.index)}
            >
              {h.text}
            </button>
          ))}
        </div>
      )}

      {tab === "links" && (
        <div className="right-panel-body right-panel-body--links">
          <div className="right-panel-label">
            {backlinks.length} linked mention{backlinks.length === 1 ? "" : "s"}
          </div>
          {backlinks.length === 0 && (
            <div className="right-panel-empty right-panel-empty--left">
              Nothing links to this note yet.
            </div>
          )}
          <div className="backlink-cards">
            {backlinks.map((bl) => (
              <button key={bl.noteId} className="backlink-card" onClick={() => onNavigateToNote(bl.noteId)}>
                <span className="backlink-card-title">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M7 2H10V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M10 2L5.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <path d="M5 3H2v7h7V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {bl.title}
                </span>
                <span className="backlink-card-context">
                  {bl.pre}
                  <span className="backlink-card-match">{bl.match}</span>
                  {bl.post}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "info" && (
        <div className="right-panel-body right-panel-body--info">
          <div className="info-table">
            <div className="info-row">
              <span>Folder</span>
              <span>{note ? folderOf(note.path) ?? "Vault root" : "—"}</span>
            </div>
            <div className="info-row">
              <span>Created</span>
              <span>{formatDate(note?.created_at ?? "")}</span>
            </div>
            <div className="info-row">
              <span>Modified</span>
              <span>{formatDate(note?.updated_at ?? "")}</span>
            </div>
            <div className="info-row">
              <span>Words</span>
              <span>{words}</span>
            </div>
            <div className="info-row">
              <span>Characters</span>
              <span>{content.length}</span>
            </div>
            <div className="info-row">
              <span>Reading time</span>
              <span>{readingTimeMinutes(words)} min</span>
            </div>
          </div>
          <div className="right-panel-label right-panel-label--spaced">Tags</div>
          {tags.length === 0 && (
            <div className="right-panel-empty right-panel-empty--left">No tags in this note.</div>
          )}
          <div className="info-tags">
            {tags.map((t) => (
              <button key={t} className="info-tag" onClick={() => onTagClick(t)}>
                #{t}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
