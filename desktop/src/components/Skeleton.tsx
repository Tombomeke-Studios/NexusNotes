/**
 * Loading placeholders (#434-#437): grey shapes in the layout of what is on
 * its way, with a CSS-only shimmer (index.css) that stops under reduced
 * motion. Each announces itself once as a status for screen readers.
 */

// Fixed widths so the placeholder doesn't jump between renders.
const TREE_WIDTHS = ["72%", "58%", "84%", "46%", "66%", "78%", "52%", "62%"];
const NOTE_WIDTHS = ["94%", "88%", "97%", "62%"];
// A small, balanced cluster in a 200x140 box.
const GRAPH_NODES: Array<[number, number, number]> = [
  [100, 70, 9],
  [52, 40, 6],
  [150, 36, 7],
  [40, 104, 5],
  [158, 108, 6],
  [100, 122, 4],
  [96, 20, 4],
];

export function SkeletonTree({ rows = 7 }: { rows?: number }) {
  return (
    <div className="skeleton-tree" role="status" aria-label="Loading notes">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton skeleton-tree-row" style={{ width: TREE_WIDTHS[i % TREE_WIDTHS.length] }} />
      ))}
    </div>
  );
}

export function SkeletonNote() {
  return (
    <div className="skeleton-note" role="status" aria-label="Loading note">
      <span className="skeleton skeleton-note-title" />
      {NOTE_WIDTHS.map((w, i) => (
        <span key={i} className="skeleton skeleton-note-line" style={{ width: w }} />
      ))}
    </div>
  );
}

export function SkeletonGraph() {
  return (
    <div className="skeleton-graph" role="status" aria-label="Loading graph">
      <svg viewBox="0 0 200 140" width="220" height="154" aria-hidden="true">
        {GRAPH_NODES.slice(1).map(([x, y], i) => (
          <line key={i} x1={GRAPH_NODES[0][0]} y1={GRAPH_NODES[0][1]} x2={x} y2={y} className="skeleton-graph-edge" />
        ))}
        {GRAPH_NODES.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} className="skeleton-graph-node" style={{ animationDelay: `${i * 140}ms` }} />
        ))}
      </svg>
    </div>
  );
}
