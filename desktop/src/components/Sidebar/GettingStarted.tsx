import { useEffect, useState } from "react";
import {
  CHECKLIST_STEPS,
  checklistVisible,
  dismissChecklist,
  loadChecklist,
  subscribeChecklist,
} from "../../lib/checklist";

/** First-launch checklist card at the top of the sidebar (#447). */
export function GettingStarted() {
  const [state, setState] = useState(loadChecklist);
  useEffect(() => subscribeChecklist(() => setState(loadChecklist())), []);

  if (!state || !checklistVisible(state)) return null;
  const done = new Set(state.done);

  return (
    <section className="checklist" role="region" aria-label="Get started">
      <div className="checklist-head">
        <span className="checklist-title">Get started</span>
        <span className="checklist-count">
          {done.size} of {CHECKLIST_STEPS.length}
        </span>
        <button className="checklist-close" aria-label="Hide the checklist" onClick={dismissChecklist}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="checklist-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${done.size / CHECKLIST_STEPS.length})` }} />
      </div>
      <ul className="checklist-steps">
        {CHECKLIST_STEPS.map((step) => {
          const isDone = done.has(step.id);
          return (
            <li
              key={step.id}
              className={`checklist-step${isDone ? " checklist-step--done" : ""}`}
              aria-label={`${step.label}, ${isDone ? "done" : "to do"}`}
            >
              <span className="checklist-tick" aria-hidden="true">
                {isDone && (
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6.3 5 8.6l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="checklist-label">{step.label}</span>
              {!isDone && <span className="checklist-hint">{step.hint}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
