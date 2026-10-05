import { useRef, useEffect, useCallback, useState } from "react";
import * as d3 from "d3";
import { findGraphNode } from "../../lib/wikilinks";
import { enterDelay, fitTransform, folderColorIndex, seedPositions, type Point } from "../../lib/graphLayout";
import { relativeTimeLabel } from "../../lib/stats";
import type { GraphData } from "../../lib/wikilinks";
import { EmptyState } from "../EmptyState";
import { Tip } from "../Tip";
import "./GraphView.css";

interface GraphViewProps {
  data: GraphData;
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  /** Creates a note from an unresolved (ghost) node's title (#147). */
  onCreateNote?: (title: string) => void;
  /** Chrome-less, tighter layout for the right-panel local graph (#144). */
  compact?: boolean;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  connections: number;
  folder: string;
  ghost?: boolean;
  tags?: string[];
  updatedAt?: string;
}

/** What the hover tooltip shows (#407), positioned in the view's coordinates. */
interface Hover {
  node: SimNode;
  x: number;
  y: number;
}

/** A node's radius: hubs (more links) are bigger. */
const nodeRadius = (d: { connections: number }) => 6 + Math.min(d.connections * 2, 12);

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
  ghost?: boolean;
}

// Folder colours come from the theme tokens (#267); root notes stay neutral.
function folderColor(folder: string): string {
  const i = folderColorIndex(folder);
  return i === null ? "var(--graph-root)" : `var(--graph-folder-${i})`;
}

const reducedMotion = () => document.documentElement.dataset.rm === "1";

export function GraphView({ data, activeNoteId, onSelectNote, onCreateNote, compact = false }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [renderKey, setRenderKey] = useState(0);
  const [showOrphans, setShowOrphans] = useState(true);
  const [search, setSearch] = useState("");
  const [hover, setHover] = useState<Hover | null>(null);
  // Set by render(): highlights a node and flies the camera to it (#146).
  const flyToRef = useRef<(id: string | null) => void>(() => {});
  // Where each node was last placed, so re-renders don't re-lay out (#439),
  // and whether the first render's staggered fade-in has played.
  const positions = useRef(new Map<string, Point>());
  const entered = useRef(false);
  // The view fits the graph once it has settled after opening, and again
  // after Re-center (#267); saves while it is open keep the user's zoom.
  const fitPending = useRef(true);
  const [view, setView] = useState<"map" | "list">("map");

  const render = useCallback(() => {
    const svg = d3.select(svgRef.current);
    if (!svgRef.current) return;

    svg.selectAll("*").remove();

    const rect = svgRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const seeded = seedPositions(
      data.nodes.filter((n) => showOrphans || n.connections > 0),
      positions.current,
      width,
      height,
    );
    const nodes: SimNode[] = seeded.nodes;
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: SimLink[] = data.links
      .filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target))
      .map((l) => ({
        source: nodes.find((n) => n.id === l.source)!,
        target: nodes.find((n) => n.id === l.target)!,
        ghost: l.ghost,
      }));

    const g = svg.append("g");

    // Labels are hidden when zoomed out past this scale to reduce clutter.
    const LABEL_ZOOM = 0.85;
    const applyLabelVisibility = (k: number) => {
      g.selectAll<SVGTextElement, SimNode>(".graph-node text").style("opacity", k < LABEL_ZOOM ? 0 : 1);
    };

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        applyLabelVisibility(event.transform.k);
      });
    svg.call(zoom as unknown as (selection: d3.Selection<SVGSVGElement | null, unknown, null, undefined>) => void);
    // A re-render keeps the zoom the user had (d3 stores it on the svg).
    const kept = d3.zoomTransform(svgRef.current);
    g.attr("transform", kept.toString());
    const fitView = () => {
      const t = fitTransform(
        nodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 })),
        width,
        height,
        compact ? 24 : 56,
      );
      svg
        .transition()
        .duration(reducedMotion() ? 0 : 450)
        .call(
          zoom.transform as unknown as (
            t: d3.Transition<SVGSVGElement | null, unknown, null, undefined>,
            transform: d3.ZoomTransform,
          ) => void,
          d3.zoomIdentity.translate(t.x, t.y).scale(t.k),
        );
    };
    // Double-click on the background resets the view instead of zooming in (#407).
    svg.on("dblclick.zoom", null);
    svg.on("dblclick", () => {
      svg
        .transition()
        .duration(450)
        .call(
          zoom.transform as unknown as (
            t: d3.Transition<SVGSVGElement | null, unknown, null, undefined>,
            transform: d3.ZoomTransform,
          ) => void,
          d3.zoomIdentity,
        );
    });

    // Arrowhead for directed links; lines end at the target's rim (see tick).
    svg
      .append("defs")
      .append("marker")
      .attr("id", "graph-arrow")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,1 L9,5 L0,9 z")
      .attr("class", "graph-arrow");

    // forceX/forceY gently pull every node toward the centre so the graph stays
    // contained (dragging/pinning a node no longer flings the rest off-screen),
    // and a capped charge keeps repulsion from acting across the whole canvas.
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => (d as SimNode).id).distance(compact ? 55 : 90))
      .force("charge", d3.forceManyBody().strength(compact ? -100 : -160).distanceMax(320))
      .force("x", d3.forceX(width / 2).strength(compact ? 0.12 : 0.06))
      .force("y", d3.forceY(height / 2).strength(compact ? 0.12 : 0.06))
      .force("collision", d3.forceCollide().radius(compact ? 20 : 28));
    // Every node already placed: only settle, don't shake the whole layout.
    if (nodes.length > 0 && seeded.reused === nodes.length) simulation.alpha(0.12);

    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", (d) => `graph-link${d.ghost ? " graph-link--ghost" : ""}${activeNoteId && ((d.source as SimNode).id === activeNoteId || (d.target as SimNode).id === activeNoteId) ? " graph-link--active" : ""}`)
      .attr("marker-end", "url(#graph-arrow)");

    // A node the user dragged stays where it was put (#407); a plain click
    // (no movement) does not pin it. Re-center lays everything out afresh.
    let moved = false;
    const dragBehavior = d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        moved = false;
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        moved = true;
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", function (event, d) {
        if (!event.active) simulation.alphaTarget(0);
        if (moved) {
          d3.select(this).classed("graph-node--pinned", true);
        } else if (!d3.select(this).classed("graph-node--pinned")) {
          d.fx = null;
          d.fy = null;
        }
      });

    // Adjacency for hover-highlighting.
    const neighbors = new Map<string, Set<string>>();
    for (const l of links) {
      (neighbors.get(l.source.id) ?? neighbors.set(l.source.id, new Set()).get(l.source.id)!).add(l.target.id);
      (neighbors.get(l.target.id) ?? neighbors.set(l.target.id, new Set()).get(l.target.id)!).add(l.source.id);
    }

    const node = g.append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", (d) =>
        `graph-node ${d.id === activeNoteId ? "graph-node--active" : ""} ${d.connections === 0 ? "graph-node--orphan" : ""} ${d.ghost ? "graph-node--ghost" : ""}`)
      .style("--node-color", (d) => folderColor(d.folder))
      // Nodes are reachable by keyboard (#267): Tab to one, Enter opens it.
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (d) =>
        d.ghost ? `Create the note ${d.title}` : `Open ${d.title}, ${d.connections} link${d.connections === 1 ? "" : "s"}`,
      )
      .on("keydown", function (event: KeyboardEvent) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          (this as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      })
      .on("click", (_, d) => {
        // A ghost is an unresolved [[link]]; clicking it creates that note.
        if (d.ghost) {
          onCreateNote?.(d.title);
          return;
        }
        // Glide onto the node, then open it (#441). The side-panel graph and
        // reduced motion open at once.
        const reduced = document.documentElement.dataset.rm === "1";
        if (compact || reduced || d.x == null || d.y == null || !svgRef.current) {
          onSelectNote(d.id);
          return;
        }
        let opened = false;
        const open = () => {
          if (opened) return;
          opened = true;
          onSelectNote(d.id);
        };
        const k = Math.max(d3.zoomTransform(svgRef.current).k, 1.4);
        svg
          .interrupt()
          .transition()
          .duration(380)
          .ease(d3.easeCubicOut)
          .call(
            zoom.transform as unknown as (
              t: d3.Transition<SVGSVGElement | null, unknown, null, undefined>,
              transform: d3.ZoomTransform,
            ) => void,
            d3.zoomIdentity.translate(width / 2 - k * d.x, height / 2 - k * d.y).scale(k),
          )
          .on("end", open)
          .on("interrupt", open);
      })
      .on("dblclick", (event) => event.stopPropagation()) // not the background reset
      .on("mouseover", (event, d) => {
        const box = svgRef.current?.getBoundingClientRect();
        if (box && !compact) setHover({ node: d, x: event.clientX - box.left, y: event.clientY - box.top });
        const nb = neighbors.get(d.id) ?? new Set<string>();
        node.classed("graph-node--dim", (n) => n.id !== d.id && !nb.has(n.id));
        link.classed("graph-link--hi", (l) => l.source.id === d.id || l.target.id === d.id);
        link.classed("graph-link--dim", (l) => l.source.id !== d.id && l.target.id !== d.id);
      })
      .on("mouseout", () => {
        setHover(null);
        node.classed("graph-node--dim", false);
        link.classed("graph-link--hi", false).classed("graph-link--dim", false);
      })
      .call(dragBehavior);

    node.append("circle")
      .attr("r", nodeRadius);

    // First render: nodes fade in one after another as the simulation pushes
    // them out from the centre (#439). Later renders appear at once.
    if (!entered.current && nodes.length > 0) {
      entered.current = true;
      node
        .classed("graph-node--enter", true)
        .style("animation-delay", (_, i) => `${enterDelay(i, nodes.length)}ms`);
    }

    node.filter((d) => !!d.ghost)
      .append("title")
      .text((d) => `"${d.title}" does not exist yet — click to create it`);

    node.append("text")
      .text((d) => d.title)
      .attr("dy", (d) => nodeRadius(d) + 15)
      .attr("text-anchor", "middle");

    // Search fly-to (#146): emphasise the match, dim everything else, and
    // glide the camera onto it. A null id clears the emphasis.
    flyToRef.current = (id) => {
      node.classed("graph-node--found", (n) => n.id === id);
      node.classed("graph-node--dim", (n) => id !== null && n.id !== id);
      link.classed("graph-link--dim", () => id !== null);
      const target = id ? nodes.find((n) => n.id === id) : undefined;
      if (!target || target.x == null || target.y == null) return;
      const k = 1.4; // past LABEL_ZOOM so the found node's label is readable
      svg
        .transition()
        .duration(650)
        .call(
          zoom.transform as unknown as (
            t: d3.Transition<SVGSVGElement | null, unknown, null, undefined>,
            transform: d3.ZoomTransform,
          ) => void,
          d3.zoomIdentity.translate(width / 2 - k * target.x, height / 2 - k * target.y).scale(k),
        );
    };

    simulation.on("tick", () => {
      // End each line at the target's rim so its arrowhead stays visible.
      const end = (d: SimLink) => {
        const dx = d.target.x! - d.source.x!;
        const dy = d.target.y! - d.source.y!;
        const dist = Math.hypot(dx, dy) || 1;
        const back = (nodeRadius(d.target) + 2) / dist;
        return { x: d.target.x! - dx * back, y: d.target.y! - dy * back };
      };
      link
        .attr("x1", (d) => d.source.x!)
        .attr("y1", (d) => d.source.y!)
        .attr("x2", (d) => end(d).x)
        .attr("y2", (d) => end(d).y);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
      for (const n of nodes) positions.current.set(n.id, { x: n.x!, y: n.y! });
      if (fitPending.current && simulation.alpha() < 0.08 && nodes.length > 0) {
        fitPending.current = false;
        fitView();
      }
    });

    return () => { simulation.stop(); };
  }, [data, activeNoteId, onSelectNote, onCreateNote, showOrphans, compact]);

  useEffect(() => {
    const cleanup = render();
    return cleanup;
  }, [render, renderKey]);

  // Debounced search → highlight + fly. Only nodes currently shown can match.
  useEffect(() => {
    const timer = setTimeout(() => {
      const visible = data.nodes.filter((n) => showOrphans || n.connections > 0);
      flyToRef.current(search.trim() ? findGraphNode(visible, search)?.id ?? null : null);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, data, showOrphans]);

  const orphanCount = data.nodes.filter((n) => n.connections === 0).length;
  const noteCount = data.nodes.filter((n) => !n.ghost).length;

  if (compact) {
    return (
      <div className="graph-view graph-view--compact">
        <svg ref={svgRef} className="graph-svg" />
      </div>
    );
  }

  // Legend (#267): the biggest folders, root notes and not-yet-created ones.
  const folderCounts = new Map<string, number>();
  for (const n of data.nodes) if (!n.ghost && n.folder) folderCounts.set(n.folder, (folderCounts.get(n.folder) ?? 0) + 1);
  const legendFolders = [...folderCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const hasRoot = data.nodes.some((n) => !n.ghost && !n.folder);
  const hasGhost = data.nodes.some((n) => n.ghost);

  // List view (#267): the same graph as a table, for keyboards and screen
  // readers, and for finding a note's connections at a glance.
  const linksIn = new Map<string, number>();
  const linksOut = new Map<string, number>();
  for (const l of data.links) {
    linksOut.set(l.source, (linksOut.get(l.source) ?? 0) + 1);
    linksIn.set(l.target, (linksIn.get(l.target) ?? 0) + 1);
  }
  const listRows = [...data.nodes].sort(
    (a, b) => Number(!!a.ghost) - Number(!!b.ghost) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );

  return (
    <div className="graph-view">
      <svg ref={svgRef} className="graph-svg" style={view === "list" ? { display: "none" } : undefined} />
      {view === "list" && (
        <div className="graph-list">
          <table aria-label="Notes and their links">
            <thead>
              <tr>
                <th scope="col">Note</th>
                <th scope="col">Folder</th>
                <th scope="col">Links out</th>
                <th scope="col">Links in</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((n) => (
                <tr key={n.id} className={n.ghost ? "graph-list-ghost" : undefined}>
                  <td>
                    <button
                      className="graph-list-open"
                      onClick={() => (n.ghost ? onCreateNote?.(n.title) : onSelectNote(n.id))}
                    >
                      <span className="graph-list-dot" style={{ background: n.ghost ? "transparent" : folderColor(n.folder) }} />
                      {n.title}
                      {n.ghost && <span className="graph-list-note"> (not created yet)</span>}
                    </button>
                  </td>
                  <td>{n.folder || "—"}</td>
                  <td>{linksOut.get(n.id) ?? 0}</td>
                  <td>{linksIn.get(n.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === "map" && noteCount > 0 && (
        <div className="graph-legend" aria-label="Legend">
          {legendFolders.map(([folder]) => (
            <span key={folder} className="graph-legend-item">
              <span className="graph-legend-dot" style={{ background: folderColor(folder) }} />
              {folder}
            </span>
          ))}
          {hasRoot && legendFolders.length > 0 && (
            <span className="graph-legend-item">
              <span className="graph-legend-dot" style={{ background: "var(--graph-root)" }} />
              No folder
            </span>
          )}
          {hasGhost && (
            <span className="graph-legend-item">
              <span className="graph-legend-dot graph-legend-dot--ghost" />
              Not created yet
            </span>
          )}
        </div>
      )}
      {view === "map" && noteCount > 0 && (
        <Tip id="graph" className="graph-tip">
          Drag notes to arrange them, scroll to zoom, click a note to open it. Double-click the background to
          reset the view.
        </Tip>
      )}
      {/* Nothing to connect yet (#450): say how links appear. */}
      {view === "map" && (noteCount === 0 || data.links.length === 0) && (
        <div className="graph-empty">
          {noteCount === 0 ? (
            <EmptyState art="graph" title="Nothing to graph yet">
              Notes you write show up here as dots.
            </EmptyState>
          ) : (
            <EmptyState art="graph" title="No links yet">
              Link notes by typing <code>[[Note name]]</code>, and they connect here.
            </EmptyState>
          )}
        </div>
      )}
      <div className="graph-search" hidden={view === "list"}>
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearch("");
            e.stopPropagation();
          }}
          placeholder="Find note in graph..."
          spellCheck={false}
        />
        {search && (
          <button className="graph-search-clear" onClick={() => setSearch("")} title="Clear">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {hover && (
        <div className="graph-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
          <div className="graph-tooltip-title">{hover.node.title}</div>
          {hover.node.ghost ? (
            <div className="graph-tooltip-meta">Not created yet — click to create it</div>
          ) : (
            <>
              <div className="graph-tooltip-meta">
                {hover.node.connections} link{hover.node.connections === 1 ? "" : "s"}
                {hover.node.updatedAt && <> &middot; updated {relativeTimeLabel(new Date(hover.node.updatedAt))}</>}
              </div>
              {hover.node.tags && hover.node.tags.length > 0 && (
                <div className="graph-tooltip-tags">{hover.node.tags.map((t) => `#${t}`).join(" ")}</div>
              )}
            </>
          )}
        </div>
      )}
      <div className="graph-badge">
        {noteCount} {noteCount === 1 ? "note" : "notes"} &middot; {data.links.length} {data.links.length === 1 ? "link" : "links"}
      </div>
      <div className="graph-controls">
        <div className="graph-view-switch" role="group" aria-label="Show the graph as">
          <button className={`graph-toggle${view === "map" ? " graph-toggle--on" : ""}`} aria-pressed={view === "map"} onClick={() => setView("map")}>
            Map
          </button>
          <button className={`graph-toggle${view === "list" ? " graph-toggle--on" : ""}`} aria-pressed={view === "list"} onClick={() => setView("list")}>
            List
          </button>
        </div>
        {orphanCount > 0 && view === "map" && (
          <button
            className={`graph-toggle${showOrphans ? " graph-toggle--on" : ""}`}
            onClick={() => setShowOrphans((v) => !v)}
            title={showOrphans ? "Hide notes with no links" : "Show notes with no links"}
          >
            {showOrphans ? "Hide" : "Show"} {orphanCount} orphan{orphanCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
      <button
        className="graph-recenter"
        onClick={() => {
          // Re-center lays everything out afresh, then fits it.
          positions.current.clear();
          fitPending.current = true;
          setRenderKey((k) => k + 1);
        }}
        title="Lay the graph out again (releases pinned notes)"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2" fill="currentColor" />
          <circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.2" />
        </svg>
        Re-center
      </button>
    </div>
  );
}
