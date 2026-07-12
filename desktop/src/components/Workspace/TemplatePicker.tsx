import { useState, useEffect } from "react";
import type { Note } from "../../lib/types";
import { TEMPLATES_FOLDER } from "../../lib/templates";
import "./Workspace.css";

interface TemplatePickerProps {
  templates: Note[];
  onPick: (template: Note) => void;
  onClose: () => void;
}

/**
 * Ctrl+T picker (#155): choose a note from the vault's Templates folder to
 * insert into the active note at the cursor, with {{date}}/{{time}}/{{title}}
 * substituted.
 */
export function TemplatePicker({ templates, onPick, onClose }: TemplatePickerProps) {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, templates.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && templates[selected]) {
        e.preventDefault();
        onPick(templates[selected]);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [templates, selected, onPick, onClose]);

  return (
    <div className="tpl-overlay" onClick={onClose}>
      <div className="tpl-picker" role="dialog" aria-label="Insert template" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-picker-head">Insert template</div>
        {templates.length === 0 ? (
          <div className="tpl-picker-empty">
            No templates yet. Create notes inside a &ldquo;{TEMPLATES_FOLDER}&rdquo; folder and
            they will show up here. <code>{"{{date}}"}</code>, <code>{"{{time}}"}</code> and{" "}
            <code>{"{{title}}"}</code> are filled in on insert.
          </div>
        ) : (
          <div className="tpl-picker-list">
            {templates.map((t, i) => (
              <button
                key={t.id}
                className={`tpl-picker-item${i === selected ? " tpl-picker-item--selected" : ""}`}
                onClick={() => onPick(t)}
                onMouseEnter={() => setSelected(i)}
              >
                <span className="tpl-picker-title">{t.title}</span>
                <span className="tpl-picker-preview">
                  {t.content.replace(/\s+/g, " ").trim().slice(0, 70) || "(empty template)"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
