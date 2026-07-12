import { useRef, useEffect, useCallback, useState } from "react";
import * as d3 from "d3";
import { findGraphNode } from "../../lib/wikilinks";
import type { GraphData } from "../../lib/wikilinks";
import "./GraphView.css";

interface GraphViewProps {
  data: GraphData;
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  /** Creates a note from an unresolved (ghost) node's title (#147). */
  onCreateNote?: (title: string) => void;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  connections: number;
  folder: string;
  ghost?: boolean;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
  ghost?: boolean;
}

// Distinct, on-brand colours assigned to folders; root notes stay neutral.
const FOLDER_PALETTE = [
  "#cba6f7", "#89b4fa", "#94e2d5", "#f9e2af", "#fab387",
  "#f38ba8", "#a6e3a1", "#f5c2e7", "#74c7ec", "#b4befe",
];
const ROOT_COLOR = "#7f849c";

function folderColor(folder: string): string {
  if (!folder) return ROOT_COLOR;
  let hash = 0;
  for (let i = 0; i < folder.length; i++) hash = (hash * 31 + folder.charCodeAt(i)) | 0;
  return FOLDER_PALETTE[Math.abs(hash) % FOLDER_PALETTE.length];
}

export function GraphView({ data, activeNoteId, onSelectNote, onCreateNote }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [renderKey, setRenderKey] = useState(0);
  const [showOrphans, setShowOrphans] = useState(true);
  const [search, setSearch] = useState("");
  // Set by render(): highlights a node and flies the camera to it (#146).
  const flyToRef = useRef<(id: string | null) => void>(() => {});

  const render = useCallback(() => {
    const svg = d3.select(svgRef.current);
    if (!svgRef.current) return;

    svg.selectAll("*").remove();

    const rect = svgRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const nodes: SimNode[] = data.nodes
      .filter((n) => showOrphans || n.connections > 0)
      .map((n) => ({ ...n }));
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

    // forceX/forceY gently pull every node toward the centre so the graph stays
    // contained (dragging/pinning a node no longer flings the rest off-screen),
    // and a capped charge keeps repulsion from acting across the whole canvas.
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => (d as SimNode).id).distance(90))
      .force("charge", d3.forceManyBody().strength(-160).distanceMax(320))
      .force("x", d3.forceX(width / 2).strength(0.06))
      .force("y", d3.forceY(height / 2).strength(0.06))
      .force("collision", d3.forceCollide().radius(28));

    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", (d) => `graph-link${d.ghost ? " graph-link--ghost" : ""}`);

    const dragBehavior = d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
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
      .on("click", (_, d) => {
        // A ghost is an unresolved [[link]]; clicking it creates that note.
        if (d.ghost) onCreateNote?.(d.title);
        else onSelectNote(d.id);
      })
      .on("mouseover", (_, d) => {
        const nb = neighbors.get(d.id) ?? new Set<string>();
        node.classed("graph-node--dim", (n) => n.id !== d.id && !nb.has(n.id));
        link.classed("graph-link--hi", (l) => l.source.id === d.id || l.target.id === d.id);
        link.classed("graph-link--dim", (l) => l.source.id !== d.id && l.target.id !== d.id);
      })
      .on("mouseout", () => {
        node.classed("graph-node--dim", false);
        link.classed("graph-link--hi", false).classed("graph-link--dim", false);
      })
      .call(dragBehavior);

    node.append("circle")
      .attr("r", (d) => 6 + Math.min(d.connections * 2, 12));

    node.filter((d) => !!d.ghost)
      .append("title")
      .text((d) => `"${d.title}" does not exist yet — click to create it`);

    node.append("text")
      .text((d) => d.title)
      .attr("dy", (d) => 6 + Math.min(d.connections * 2, 12) + 15)
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
      link
        .attr("x1", (d) => d.source.x!)
        .attr("y1", (d) => d.source.y!)
        .attr("x2", (d) => d.target.x!)
        .attr("y2", (d) => d.target.y!);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    return () => { simulation.stop(); };
  }, [data, activeNoteId, onSelectNote, onCreateNote, showOrphans]);

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

  return (
    <div className="graph-view">
      <svg ref={svgRef} className="graph-svg" />
      <div className="graph-search">
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
      <div className="graph-badge">
        {noteCount} notes &middot; {data.links.length} links
      </div>
      {orphanCount > 0 && (
        <div className="graph-controls">
          <button
            className={`graph-toggle${showOrphans ? " graph-toggle--on" : ""}`}
            onClick={() => setShowOrphans((v) => !v)}
            title={showOrphans ? "Hide notes with no links" : "Show notes with no links"}
          >
            {showOrphans ? "Hide" : "Show"} {orphanCount} orphan{orphanCount === 1 ? "" : "s"}
          </button>
        </div>
      )}
      <button className="graph-recenter" onClick={() => setRenderKey((k) => k + 1)}>
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2" fill="currentColor" />
          <circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.2" />
        </svg>
        Re-center
      </button>
    </div>
  );
}
