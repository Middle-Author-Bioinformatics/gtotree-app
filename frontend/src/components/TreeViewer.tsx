import { useMemo, useState } from "react";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// Minimal Newick parser + SVG phylogram renderer (no external deps).
// Handles standard Newick: (A:0.1,(B:0.2,C:0.3):0.4)root:0.0;  with support
// values in internal node names. Renders a rectangular tree with branch lengths
// (phylogram) or equal depths (cladogram), tip labels, and zoom.
// ---------------------------------------------------------------------------

interface Node {
  name: string;
  length: number;
  children: Node[];
  // layout
  x?: number;   // horizontal (depth) position
  y?: number;   // vertical position
  depth?: number;
}

function parseNewick(s: string): Node | null {
  s = s.trim();
  if (!s) return null;
  if (!s.endsWith(";")) s += ";";
  let i = 0;

  function readName(): string {
    let start = i;
    while (i < s.length && !",():;".includes(s[i])) i++;
    return s.slice(start, i).trim().replace(/^['"]|['"]$/g, "");
  }
  function readLength(): number {
    if (s[i] === ":") {
      i++;
      let start = i;
      while (i < s.length && !",():;".includes(s[i])) i++;
      const v = parseFloat(s.slice(start, i));
      return Number.isFinite(v) ? v : 0;
    }
    return 0;
  }
  function parseNode(): Node {
    const node: Node = { name: "", length: 0, children: [] };
    if (s[i] === "(") {
      i++; // consume (
      do {
        node.children.push(parseNode());
        if (s[i] === ",") { i++; continue; }
      } while (s[i] !== ")" && i < s.length);
      if (s[i] === ")") i++; // consume )
    }
    node.name = readName();
    node.length = readLength();
    return node;
  }

  try {
    const root = parseNode();
    return root;
  } catch {
    return null;
  }
}

function collectTips(n: Node, acc: Node[] = []): Node[] {
  if (n.children.length === 0) acc.push(n);
  else n.children.forEach((c) => collectTips(c, acc));
  return acc;
}

function maxDepth(n: Node, cur = 0, useLen = true): number {
  const step = useLen ? n.length : 1;
  if (n.children.length === 0) return cur + step;
  return Math.max(...n.children.map((c) => maxDepth(c, cur + step, useLen)));
}

interface Props {
  newick: string;
  downloadUrl?: string;
  onDownload?: () => Promise<void>;
}

export function TreeViewer({ newick, downloadUrl, onDownload }: Props) {
  const [downloading,setDownloading]=useState(false),[downloadFailed,setDownloadFailed]=useState(false);
  const [phylogram, setPhylogram] = useState(true); // branch lengths vs cladogram
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState("");

  const root = useMemo(() => parseNewick(newick), [newick]);

  const layout = useMemo(() => {
    if (!root) return null;
    const tips = collectTips(root);
    const tipCount = tips.length || 1;
    const rowH = 18;
    const height = Math.max(tipCount * rowH + 40, 120);
    const md = maxDepth(root, 0, phylogram) || 1;
    const labelPad = 220;         // room for tip labels on the right
    const width = 640;
    const plotW = width - labelPad;

    let tipIndex = 0;
    // assign x (depth) & y (row)
    function assign(n: Node, depth: number): number {
      const x = phylogram ? depth : n.depth ?? depth;
      if (n.children.length === 0) {
        n.x = (x / md) * plotW;
        n.y = 20 + tipIndex * rowH + rowH / 2;
        tipIndex++;
        return n.y;
      }
      const ys = n.children.map((c) => assign(c, depth + (phylogram ? c.length : 1)));
      n.x = (x / md) * plotW;
      n.y = (Math.min(...ys) + Math.max(...ys)) / 2;
      return n.y;
    }
    // For cladogram, precompute integer depths from root
    if (!phylogram) {
      (function setDepth(n: Node, d: number) {
        n.depth = d;
        n.children.forEach((c) => setDepth(c, d + 1));
      })(root, 0);
    }
    assign(root, phylogram ? root.length : 0);

    return { root, tips, width, height, labelPad, plotW, md };
  }, [root, phylogram]);

  if (!root || !layout) {
    return (
      <div className="text-sm text-fg-muted text-center py-10">
        Could not parse the tree file as Newick.
      </div>
    );
  }

  // Build SVG edges + tip labels
  const edges: JSX.Element[] = [];
  const labels: JSX.Element[] = [];
  const q = (s: string) => s.toLowerCase();
  const fq = q(filter);

  (function draw(n: Node, parent?: Node) {
    if (parent) {
      // elbow: horizontal from parent.x→n.x at n.y, plus vertical connector at parent.x
      edges.push(
        <path key={`e-${n.x}-${n.y}-${Math.random()}`}
          d={`M ${parent.x} ${parent.y} V ${n.y} H ${n.x}`}
          fill="none" stroke="rgb(var(--border))" strokeWidth={1} />
      );
    }
    if (n.children.length === 0) {
      const hit = fq && q(n.name).includes(fq);
      labels.push(
        <text key={`t-${n.y}`} x={(n.x ?? 0) + 6} y={(n.y ?? 0) + 3}
          fontSize={11}
          className={cn("font-mono", hit ? "fill-accent" : "fill-[rgb(var(--fg-muted))]")}
          fontWeight={hit ? 700 : 400}>
          {n.name || "(unnamed)"}
        </text>
      );
    }
    n.children.forEach((c) => draw(c, n));
  })(root);

  const svgW = layout.width * zoom;
  const svgH = layout.height * zoom;

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1 text-xs">
          <button onClick={() => setPhylogram(true)}
            className={cn("px-2.5 py-1 rounded-md inline-flex items-center gap-1.5 transition-colors",
              phylogram ? "bg-surface text-fg shadow-panel" : "text-fg-muted hover:text-fg")}>
            Phylogram
          </button>
          <button onClick={() => setPhylogram(false)}
            className={cn("px-2.5 py-1 rounded-md inline-flex items-center gap-1.5 transition-colors",
              !phylogram ? "bg-surface text-fg shadow-panel" : "text-fg-muted hover:text-fg")}>
            Cladogram
          </button>
        </div>

        <div className="inline-flex items-center gap-1 text-xs">
          <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} className="btn-ghost py-1 px-2">−</button>
          <span className="font-mono text-fg-muted w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} className="btn-ghost py-1 px-2">+</button>
        </div>

        <div className="relative ml-auto">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Highlight tip"
            placeholder="Highlight tip"
            className="field py-1.5 text-xs w-44"
          />
        </div>

        {onDownload?<button className="btn-ghost py-1.5 text-xs" disabled={downloading} onClick={async()=>{setDownloading(true);setDownloadFailed(false);try{await onDownload();}catch{setDownloadFailed(true);}finally{setDownloading(false);}}}>{downloading?'Preparing…':downloadFailed?'Retry download':'Newick'}</button>:downloadUrl && (
          <a href={downloadUrl} target="_blank" rel="noreferrer" download
            className="btn-ghost py-1.5 text-xs">
            Newick
          </a>
        )}
      </div>

      {/* tree */}
      <div className="overflow-auto rounded-lg border border-border bg-surface" style={{ maxHeight: "70vh" }}>
        <svg width={svgW} height={svgH} viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMinYMin meet" className="block">
          {edges}
          {labels}
        </svg>
      </div>
      <p className="text-[11px] text-fg-subtle">
        {collectTips(root).length} tips ·{" "}
        {phylogram ? "branch lengths to scale" : "equal branch depths (topology only)"}.
      </p>
    </div>
  );
}

