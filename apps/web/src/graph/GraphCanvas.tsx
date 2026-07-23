import { useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useTheme } from '../theme/theme-context.js';

export interface GraphNode {
  id: string;
  name: string;
  kind: string;
  path: string | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

const KIND_COLORS: Record<string, string> = {
  Function: '#a855f7',
  Class: '#f59e0b',
  Component: '#0ea5e9',
  Hook: '#14b8a6',
  Interface: '#10b981',
  TypeAlias: '#10b981',
  Variable: '#94a3b8',
  File: '#64748b',
};

function colorFor(kind: string): string {
  return KIND_COLORS[kind] ?? '#64748b';
}

/**
 * Force-directed subgraph renderer (issue #60), canvas-based via
 * react-force-graph-2d so pan/zoom stays smooth at hundreds of nodes.
 */
export function GraphCanvas({
  nodes,
  edges,
  focusId,
  onNodeClick,
  width,
  height,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusId?: string;
  onNodeClick: (node: GraphNode) => void;
  width: number;
  height: number;
}) {
  const { theme } = useTheme();

  const graphData = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ ...n })),
      links: edges.map((e) => ({ source: e.from, target: e.to, type: e.type })),
    }),
    [nodes, edges],
  );

  return (
    <ForceGraph2D
      graphData={graphData}
      width={width}
      height={height}
      backgroundColor={theme === 'dark' ? '#020617' : '#f8fafc'}
      nodeLabel={(node) => `${String(node['name'])} (${String(node['kind'])})`}
      nodeColor={(node) => {
        const n = node as unknown as GraphNode;
        return n.id === focusId ? '#ef4444' : colorFor(n.kind);
      }}
      nodeRelSize={5}
      linkColor={() => (theme === 'dark' ? '#334155' : '#cbd5e1')}
      linkDirectionalArrowLength={4}
      linkDirectionalArrowRelPos={1}
      linkLabel={(link) => String((link as unknown as GraphEdge).type)}
      onNodeClick={(node) => onNodeClick(node)}
      nodeCanvasObjectMode={() => 'after'}
      nodeCanvasObject={(node, ctx, globalScale) => {
        const label = String(node['name']);
        const fontSize = 11 / globalScale;
        ctx.font = `${String(fontSize)}px sans-serif`;
        ctx.fillStyle = theme === 'dark' ? '#e2e8f0' : '#1e293b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + 7);
      }}
    />
  );
}
