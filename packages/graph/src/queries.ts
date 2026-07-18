import { z } from 'zod';
import { edgeKindSchema, NotFoundError, ValidationError } from '@twograph/core';
import type { GraphClient } from './client.js';

export interface GraphNodeSummary {
  id: string;
  name: string;
  kind: string;
  path: string | null;
  startLine?: number;
  endLine?: number;
  signature?: string;
  doc?: string;
}

export interface HierarchyEntry extends GraphNodeSummary {
  depth: number;
}

export interface SubgraphResult {
  nodes: GraphNodeSummary[];
  edges: { from: string; to: string; type: string }[];
}

const clampDepth = (depth: number): number => {
  if (!Number.isInteger(depth) || depth < 1 || depth > 5) {
    throw new ValidationError(`depth must be an integer in [1,5], got ${String(depth)}`);
  }
  return depth;
};

function toSummary(row: { get(key: string): unknown }): GraphNodeSummary {
  const summary: GraphNodeSummary = {
    id: row.get('id') as string,
    name: row.get('name') as string,
    kind: row.get('kind') as string,
    path: (row.get('path') as string | null) ?? null,
  };
  return summary;
}

const RETURN_SUMMARY = (v: string): string =>
  `${v}.id AS id, ${v}.name AS name, labels(${v})[0] AS kind, ${v}.path AS path`;

/**
 * Typed, parameterized query layer (issue #28). Surfaces never concatenate
 * Cypher — they call these methods or the safe template registry below.
 */
export class GraphQueries {
  constructor(private readonly client: GraphClient) {}

  /** Upstream call hierarchy: who (transitively) calls this symbol. */
  async callers(repo: string, symbolId: string, depth = 2): Promise<HierarchyEntry[]> {
    const d = clampDepth(depth);
    const rows = await this.client.run(
      `MATCH p = (caller)-[:CALLS*1..${String(d)}]->(t {id: $id})
       WHERE t.repoId = $repo
       RETURN DISTINCT ${RETURN_SUMMARY('caller')}, length(p) AS depth
       ORDER BY depth, name`,
      { id: symbolId, repo },
    );
    return rows.map((r) => ({ ...toSummary(r), depth: r.get('depth') as number }));
  }

  /** Downstream call hierarchy: what this symbol (transitively) calls. */
  async callees(repo: string, symbolId: string, depth = 2): Promise<HierarchyEntry[]> {
    const d = clampDepth(depth);
    const rows = await this.client.run(
      `MATCH p = (s {id: $id})-[:CALLS*1..${String(d)}]->(callee)
       WHERE s.repoId = $repo
       RETURN DISTINCT ${RETURN_SUMMARY('callee')}, length(p) AS depth
       ORDER BY depth, name`,
      { id: symbolId, repo },
    );
    return rows.map((r) => ({ ...toSummary(r), depth: r.get('depth') as number }));
  }

  /** Which components (transitively) render this component. */
  async componentUsage(repo: string, componentId: string, depth = 3): Promise<HierarchyEntry[]> {
    const d = clampDepth(depth);
    const rows = await this.client.run(
      `MATCH p = (user:Component)-[:USES_COMPONENT*1..${String(d)}]->(c {id: $id})
       WHERE c.repoId = $repo
       RETURN DISTINCT ${RETURN_SUMMARY('user')}, length(p) AS depth
       ORDER BY depth, name`,
      { id: componentId, repo },
    );
    return rows.map((r) => ({ ...toSummary(r), depth: r.get('depth') as number }));
  }

  /** Immediate neighbors grouped by direction and edge type. */
  async neighbors(
    repo: string,
    symbolId: string,
  ): Promise<{
    outgoing: (GraphNodeSummary & { edge: string })[];
    incoming: (GraphNodeSummary & { edge: string })[];
  }> {
    const outgoing = await this.client.run(
      `MATCH (s {id: $id})-[r]->(m) WHERE s.repoId = $repo
       RETURN type(r) AS edge, ${RETURN_SUMMARY('m')}`,
      { id: symbolId, repo },
    );
    const incoming = await this.client.run(
      `MATCH (s {id: $id})<-[r]-(m) WHERE s.repoId = $repo
       RETURN type(r) AS edge, ${RETURN_SUMMARY('m')}`,
      { id: symbolId, repo },
    );
    const map = (rows: typeof outgoing) =>
      rows.map((r) => ({ ...toSummary(r), edge: r.get('edge') as string }));
    return { outgoing: map(outgoing), incoming: map(incoming) };
  }

  /** Node detail with all stored properties. */
  async symbolDetail(repo: string, symbolId: string): Promise<Record<string, unknown>> {
    const rows = await this.client.run(
      `MATCH (s {id: $id}) WHERE s.repoId = $repo
       RETURN properties(s) AS props, labels(s)[0] AS kind`,
      { id: symbolId, repo },
    );
    const first = rows[0];
    if (!first) throw new NotFoundError(`symbol not found: ${symbolId}`);
    return { ...(first.get('props') as Record<string, unknown>), kind: first.get('kind') };
  }

  /** Bounded subgraph for visualization, filtered by edge types. */
  async subgraph(
    repo: string,
    rootId: string,
    edgeTypes: string[] = ['CALLS', 'USES_COMPONENT', 'USES_HOOK', 'IMPORTS', 'CONTAINS'],
    depth = 2,
  ): Promise<SubgraphResult> {
    const d = clampDepth(depth);
    const types = edgeTypes.map((t) => edgeKindSchema.parse(t)).join('|');
    const rows = await this.client.run(
      `MATCH p = (root {id: $id})-[:${types}*1..${String(d)}]-(n)
       WHERE root.repoId = $repo
       UNWIND relationships(p) AS rel
       RETURN DISTINCT startNode(rel).id AS fromId, endNode(rel).id AS toId, type(rel) AS type,
              startNode(rel).name AS fromName, endNode(rel).name AS toName,
              labels(startNode(rel))[0] AS fromKind, labels(endNode(rel))[0] AS toKind,
              startNode(rel).path AS fromPath, endNode(rel).path AS toPath`,
      { id: rootId, repo },
    );
    const nodes = new Map<string, GraphNodeSummary>();
    const edges: SubgraphResult['edges'] = [];
    for (const r of rows) {
      const from = r.get('fromId') as string;
      const to = r.get('toId') as string;
      nodes.set(from, {
        id: from,
        name: r.get('fromName') as string,
        kind: r.get('fromKind') as string,
        path: (r.get('fromPath') as string | null) ?? null,
      });
      nodes.set(to, {
        id: to,
        name: r.get('toName') as string,
        kind: r.get('toKind') as string,
        path: (r.get('toPath') as string | null) ?? null,
      });
      edges.push({ from, to, type: r.get('type') as string });
    }
    return { nodes: [...nodes.values()], edges };
  }

  /** All file paths of a repository (explorer tree is built client-side). */
  async filePaths(repo: string): Promise<string[]> {
    const rows = await this.client.run(
      'MATCH (f:File {repoId: $repo}) RETURN f.path AS path ORDER BY path',
      { repo },
    );
    return rows.map((r) => r.get('path') as string);
  }

  /** Shortest undirected path between two symbols (BFS, bounded). */
  async shortestPath(
    repo: string,
    fromId: string,
    toId: string,
  ): Promise<{ nodeIds: string[]; edgeTypes: string[] } | null> {
    const rows = await this.client.run(
      `MATCH (a {id: $from}), (b {id: $to}), p = (a)-[*BFS ..10]-(b)
       WHERE a.repoId = $repo
       RETURN [n IN nodes(p) | n.id] AS nodeIds, [r IN relationships(p) | type(r)] AS edgeTypes
       LIMIT 1`,
      { from: fromId, to: toId, repo },
    );
    const first = rows[0];
    if (!first) return null;
    return {
      nodeIds: first.get('nodeIds') as string[],
      edgeTypes: first.get('edgeTypes') as string[],
    };
  }
}

/** Safe parameterized templates for the REST `graph/query` endpoint and MCP. */
export interface QueryTemplate {
  description: string;
  params: z.ZodType<Record<string, unknown>>;
  cypher: string;
}

export const QUERY_TEMPLATES: Record<string, QueryTemplate> = {
  who_calls: {
    description: 'Callers of a symbol by name',
    params: z.object({ repo: z.string(), name: z.string() }),
    cypher: `MATCH (caller)-[:CALLS]->(t {name: $name}) WHERE t.repoId = $repo
             RETURN caller.id AS id, caller.name AS name, caller.path AS path`,
  },
  files_depending_on: {
    description: 'Files importing a given npm dependency',
    params: z.object({ repo: z.string(), dependency: z.string() }),
    cypher: `MATCH (f:File {repoId: $repo})-[:IMPORTS]->(:Dependency {name: $dependency})
             RETURN f.path AS path`,
  },
  unused_components: {
    description: 'React components never rendered nor routed',
    params: z.object({ repo: z.string() }),
    cypher: `MATCH (c:Component {repoId: $repo})
             WHERE NOT exists(()-[:USES_COMPONENT]->(c)) AND NOT exists((c)-[:HANDLES]->(:Route))
             RETURN c.id AS id, c.name AS name, c.path AS path`,
  },
  context_flow: {
    description: 'Context providers and consumers',
    params: z.object({ repo: z.string() }),
    cypher: `MATCH (p)-[:PROVIDES_CONTEXT]->(ctx:Context {repoId: $repo})<-[:CONSUMES_CONTEXT]-(c)
             RETURN p.name AS provider, ctx.name AS context, collect(DISTINCT c.name) AS consumers`,
  },
  routes: {
    description: 'All routes with their handlers',
    params: z.object({ repo: z.string() }),
    cypher: `MATCH (r:Route {repoId: $repo}) OPTIONAL MATCH (h)-[:HANDLES]->(r)
             RETURN r.routePattern AS pattern, r.method AS method, r.framework AS framework,
                    collect(h.name) AS handlers`,
  },
};

/** Executes a registered template with validated params. */
export async function runTemplate(
  client: GraphClient,
  name: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const template = QUERY_TEMPLATES[name];
  if (!template) {
    throw new ValidationError(`unknown query template: ${name}`, {
      details: { available: Object.keys(QUERY_TEMPLATES) },
    });
  }
  const parsed = template.params.parse(params);
  const rows = await client.run(template.cypher, parsed);
  return rows.map((r) => Object.fromEntries(r.keys.map((k) => [k, r.get(k) as unknown])));
}
