import type { RankedHit } from '@twograph/core';
import type { GraphQueries } from '@twograph/graph';

export interface ExpandOptions {
  /** How many of the input seeds (in given order) to expand. Default 10. */
  topSeeds?: number;
  /** Hop radius, 1-2 per docs/07 §3. Default 2. */
  hops?: number;
  /** Per-hop score decay: expandedScore = seedScore * decay^hops. Default 0.6. */
  decay?: number;
  /** Bound on expanded nodes kept per seed — protects against hub-node explosion. Default 20. */
  maxPerSeed?: number;
  edgeTypes?: string[];
}

const DEFAULT_EDGE_TYPES = [
  'CALLS',
  'USES_COMPONENT',
  'USES_HOOK',
  'IMPORTS',
  'PROVIDES_CONTEXT',
  'CONSUMES_CONTEXT',
];

interface ParentEdge {
  parent: string;
  type: string;
  /** True if the stored edge points parent -> node; false if node -> parent. */
  forward: boolean;
}

/**
 * Expands top-N fused seeds 1-2 hops along structural/behavioral/React edges
 * (docs/07 §3): turns "best matching function" into "the whole payment flow".
 * Expanded nodes carry a decayed score and a human-readable graphPath, and are
 * capped per seed so a hub node can't flood the candidate pool.
 */
export async function expandSeeds(
  queries: GraphQueries,
  repo: string,
  seeds: RankedHit[],
  options: ExpandOptions = {},
): Promise<RankedHit[]> {
  const hops = options.hops ?? 2;
  const decay = options.decay ?? 0.6;
  const maxPerSeed = options.maxPerSeed ?? 20;
  const edgeTypes = options.edgeTypes ?? DEFAULT_EDGE_TYPES;
  const topSeeds = seeds.slice(0, options.topSeeds ?? 10);

  const best = new Map<string, RankedHit>();

  for (const seed of topSeeds) {
    const { nodes, edges } = await queries.subgraph(repo, seed.symbolId, edgeTypes, hops);
    const nodeNames = new Map(nodes.map((n) => [n.id, n.name]));
    const { dist, parentEdge } = bfsFrom(seed.symbolId, edges, hops);

    const expanded = [...dist.entries()]
      .filter(([id, d]) => id !== seed.symbolId && d > 0)
      .sort((a, b) => a[1] - b[1])
      .slice(0, maxPerSeed);

    for (const [id, d] of expanded) {
      const score = seed.score * decay ** d;
      const existing = best.get(id);
      if (existing && existing.score >= score) continue;
      best.set(id, {
        symbolId: id,
        score,
        source: 'expansion',
        graphPath: reconstructPath(id, parentEdge, nodeNames),
        provenance: {},
      });
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
}

function bfsFrom(
  root: string,
  edges: { from: string; to: string; type: string }[],
  maxHops: number,
): { dist: Map<string, number>; parentEdge: Map<string, ParentEdge> } {
  const adjacency = new Map<string, { to: string; type: string; forward: boolean }[]>();
  const link = (from: string, to: string, type: string, forward: boolean): void => {
    const existing = adjacency.get(from);
    if (existing) existing.push({ to, type, forward });
    else adjacency.set(from, [{ to, type, forward }]);
  };
  for (const e of edges) {
    link(e.from, e.to, e.type, true);
    link(e.to, e.from, e.type, false);
  }

  const dist = new Map<string, number>([[root, 0]]);
  const parentEdge = new Map<string, ParentEdge>();
  const queue = [root];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    const currentDist = dist.get(current)!;
    if (currentDist >= maxHops) continue;
    for (const edge of adjacency.get(current) ?? []) {
      if (dist.has(edge.to)) continue;
      dist.set(edge.to, currentDist + 1);
      parentEdge.set(edge.to, { parent: current, type: edge.type, forward: edge.forward });
      queue.push(edge.to);
    }
  }
  return { dist, parentEdge };
}

function reconstructPath(
  nodeId: string,
  parentEdge: Map<string, ParentEdge>,
  nodeNames: Map<string, string>,
): string {
  const nameOf = (id: string): string => nodeNames.get(id) ?? id;
  const chain: string[] = [nameOf(nodeId)];
  let current = nodeId;
  while (parentEdge.has(current)) {
    const edge = parentEdge.get(current)!;
    chain.unshift(edge.forward ? `-[${edge.type}]->` : `<-[${edge.type}]-`);
    chain.unshift(nameOf(edge.parent));
    current = edge.parent;
  }
  return chain.join(' ');
}
