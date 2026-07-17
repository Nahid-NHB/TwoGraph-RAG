import type { CodeSymbol, ParsedFile, SymbolKind } from '@twograph/core';
import type { GraphClient } from './client.js';
import type { NodeLabel } from './schema.js';

/** SymbolKind → node label (docs/05 §1). */
export const KIND_LABEL: Record<SymbolKind, NodeLabel> = {
  function: 'Function',
  class: 'Class',
  method: 'Method',
  hook: 'Hook',
  component: 'Component',
  interface: 'Interface',
  enum: 'Enum',
  typeAlias: 'TypeAlias',
  variable: 'Variable',
  route: 'Route',
  api: 'Api',
  context: 'Context',
  test: 'Test',
};

const LABEL_SET = new Set<string>(Object.values(KIND_LABEL));

export interface RepoInfo {
  id: string;
  name: string;
  rootPath: string;
}

interface NodeRow {
  id: string;
  props: Record<string, unknown>;
}

/** Scalar meta keys lifted to first-class node properties. */
const LIFTED_META = [
  'componentKind',
  'propsType',
  'builtin',
  'abstract',
  'static',
  'visibility',
  'async',
  'generator',
  'arrow',
  'varKind',
  'framework',
  'routePattern',
  'method',
  'const',
] as const;

export function symbolProps(symbol: CodeSymbol): Record<string, unknown> {
  const props: Record<string, unknown> = {
    repoId: symbol.repo,
    path: symbol.path,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    startLine: symbol.span.startLine,
    endLine: symbol.span.endLine,
    exported: symbol.exported,
    contentHash: symbol.contentHash,
  };
  if (symbol.signature !== undefined) props['signature'] = symbol.signature;
  if (symbol.doc) props['doc'] = symbol.doc.summary;
  for (const key of LIFTED_META) {
    const value = symbol.meta[key];
    if (value !== undefined && (typeof value !== 'object' || value === null)) props[key] = value;
  }
  const rest = Object.fromEntries(
    Object.entries(symbol.meta).filter(([k]) => !(LIFTED_META as readonly string[]).includes(k)),
  );
  if (Object.keys(rest).length > 0) props['meta'] = JSON.stringify(rest);
  return props;
}

function assertLabel(label: string): string {
  if (!LABEL_SET.has(label) && !['Repository', 'Directory', 'File', 'Package'].includes(label)) {
    throw new Error(`unexpected label: ${label}`);
  }
  return label;
}

/**
 * Writes ParsedFiles into the knowledge graph. Issue #23 scope: idempotent
 * node upserts (MERGE) and the CONTAINS hierarchy
 * Repository → Directory* → File → symbol. Batched with UNWIND per label.
 */
export class GraphWriter {
  constructor(private readonly client: GraphClient) {}

  async ensureRepository(repo: RepoInfo): Promise<void> {
    await this.client.run(
      'MERGE (r:Repository {id: $id}) SET r.repoId = $id, r.name = $name, r.rootPath = $rootPath',
      { id: repo.id, name: repo.name, rootPath: repo.rootPath },
    );
  }

  /** Upserts all nodes for one parsed file plus its CONTAINS chain. */
  async writeParsedFile(parsed: ParsedFile): Promise<void> {
    const fileId = `${parsed.repo}:${parsed.path}`;

    // Directory chain nodes.
    const dirRows: NodeRow[] = [];
    const segments = parsed.path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const dirPath = segments.slice(0, i).join('/');
      dirRows.push({
        id: `${parsed.repo}:${dirPath}`,
        props: { repoId: parsed.repo, path: dirPath, name: segments[i - 1] },
      });
    }
    if (dirRows.length > 0) {
      await this.client.run(
        'UNWIND $rows AS row MERGE (d:Directory {id: row.id}) SET d += row.props',
        { rows: dirRows },
      );
    }

    await this.client.run('MERGE (f:File {id: $id}) SET f += $props', {
      id: fileId,
      props: {
        repoId: parsed.repo,
        path: parsed.path,
        name: segments.at(-1),
        language: parsed.language,
        contentHash: parsed.contentHash,
        ...(parsed.fileDoc !== undefined ? { doc: parsed.fileDoc } : {}),
      },
    });

    // Symbol nodes, batched per label.
    const byLabel = new Map<string, NodeRow[]>();
    for (const symbol of parsed.symbols) {
      const label = KIND_LABEL[symbol.kind];
      const rows = byLabel.get(label) ?? [];
      rows.push({ id: symbol.id, props: symbolProps(symbol) });
      byLabel.set(label, rows);
    }
    for (const [label, rows] of byLabel) {
      await this.client.run(
        `UNWIND $rows AS row MERGE (s:${assertLabel(label)} {id: row.id}) SET s += row.props`,
        { rows },
      );
    }

    // CONTAINS hierarchy edges, grouped by label pair.
    const edges: { a: string; aLabel: string; b: string; bLabel: string }[] = [];
    const parentOf = (i: number): { id: string; label: string } =>
      i === 0
        ? { id: parsed.repo, label: 'Repository' }
        : { id: `${parsed.repo}:${segments.slice(0, i).join('/')}`, label: 'Directory' };
    for (let i = 0; i < segments.length - 1; i++) {
      const parent = parentOf(i);
      const child = parentOf(i + 1);
      edges.push({ a: parent.id, aLabel: parent.label, b: child.id, bLabel: 'Directory' });
    }
    const fileParent = parentOf(segments.length - 1);
    edges.push({ a: fileParent.id, aLabel: fileParent.label, b: fileId, bLabel: 'File' });
    for (const symbol of parsed.symbols) {
      edges.push({ a: fileId, aLabel: 'File', b: symbol.id, bLabel: KIND_LABEL[symbol.kind] });
    }

    const grouped = new Map<string, { a: string; b: string }[]>();
    for (const edge of edges) {
      const key = `${edge.aLabel}|${edge.bLabel}`;
      const rows = grouped.get(key) ?? [];
      rows.push({ a: edge.a, b: edge.b });
      grouped.set(key, rows);
    }
    for (const [key, rows] of grouped) {
      const [aLabel, bLabel] = key.split('|') as [string, string];
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a:${assertLabel(aLabel)} {id: row.a}), (b:${assertLabel(bLabel)} {id: row.b})
         MERGE (a)-[:CONTAINS]->(b)`,
        { rows },
      );
    }
  }
}
