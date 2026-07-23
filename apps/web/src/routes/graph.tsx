import { Download, ImageDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSubgraph } from '../api/hooks.js';
import { GraphCanvas, type GraphEdge, type GraphNode } from '../graph/GraphCanvas.js';

const EDGE_TYPES = [
  'CALLS',
  'IMPORTS',
  'EXPORTS',
  'USES_COMPONENT',
  'USES_HOOK',
  'EXTENDS',
  'IMPLEMENTS',
  'DEFINES',
];

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Interactive subgraph explorer (issue #60): force layout, edge-type/depth
 * filters, expand-on-click (merges the clicked node's own subgraph into the
 * current view rather than replacing it), and PNG/JSON export. Enters
 * focused on `?root=` when linked from a symbol/component page.
 */
export function GraphPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const root = searchParams.get('root') ?? undefined;
  const [depth, setDepth] = useState(2);
  const [enabledEdges, setEnabledEdges] = useState<Set<string>>(new Set());
  const [rootInput, setRootInput] = useState(root ?? '');
  const [expandTarget, setExpandTarget] = useState<string | undefined>();

  const [nodes, setNodes] = useState<Map<string, GraphNode>>(new Map());
  const [edges, setEdges] = useState<Map<string, GraphEdge>>(new Map());

  const edgeList = [...enabledEdges];
  const { data: rootSubgraph } = useSubgraph(repoId, root, depth, edgeList);
  const { data: expandSubgraph } = useSubgraph(repoId, expandTarget, depth, edgeList);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A new root (via the URL, e.g. entered by hand or linked from a symbol
  // page) starts a fresh view — everything else (expand-on-click, filter
  // changes) accumulates into whatever's already there.
  useEffect(() => {
    setNodes(new Map());
    setEdges(new Map());
    setExpandTarget(undefined);
  }, [root]);

  function merge(subgraph: { nodes: GraphNode[]; edges: GraphEdge[] } | undefined): void {
    if (!subgraph) return;
    setNodes((prev) => {
      const next = new Map(prev);
      for (const n of subgraph.nodes) next.set(n.id, n);
      return next;
    });
    setEdges((prev) => {
      const next = new Map(prev);
      for (const e of subgraph.edges) next.set(`${e.from}->${e.to}:${e.type}`, e);
      return next;
    });
  }

  useEffect(() => merge(rootSubgraph), [rootSubgraph]);
  useEffect(() => merge(expandSubgraph), [expandSubgraph]);

  function goToRoot(newRoot: string): void {
    setSearchParams({ root: newRoot });
  }

  function toggleEdgeType(type: string): void {
    setEnabledEdges((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function exportPng(): void {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'graph.png';
    a.click();
  }

  function exportJson(): void {
    download(
      'graph.json',
      JSON.stringify({ nodes: [...nodes.values()], edges: [...edges.values()] }, null, 2),
      'application/json',
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (rootInput.trim()) goToRoot(rootInput.trim());
          }}
          className="flex items-center gap-1"
        >
          <input
            value={rootInput}
            onChange={(e) => setRootInput(e.target.value)}
            placeholder="root symbol id"
            className="w-64 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Go
          </button>
        </form>

        <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          Depth
          <input
            type="number"
            min={1}
            max={5}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="w-12 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        <div className="flex flex-wrap gap-1">
          {EDGE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleEdgeType(type)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                enabledEdges.has(type) || enabledEdges.size === 0
                  ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                  : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={exportPng}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ImageDown size={13} /> PNG
          </button>
          <button
            type="button"
            onClick={exportJson}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Download size={13} /> JSON
          </button>
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1">
        {!root && (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Enter a root symbol id to explore its subgraph.
          </div>
        )}
        {root && nodes.size > 0 && (
          <GraphCanvas
            nodes={[...nodes.values()]}
            edges={[...edges.values()]}
            focusId={root}
            onNodeClick={(node) => setExpandTarget(node.id)}
            width={size.width}
            height={size.height}
          />
        )}
      </div>
    </div>
  );
}
