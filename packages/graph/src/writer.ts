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

/** Resolves a module specifier to a known repo-relative file path (from @twograph/parser). */
export type ModuleResolver = (fromPath: string, specifier: string) => string | undefined;

/**
 * Writes ParsedFiles into the knowledge graph: idempotent node upserts (MERGE),
 * the CONTAINS hierarchy (#23), and structural edges (#24). Batched with UNWIND.
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

  /**
   * Structural edges for one file (issue #24): DEFINES/DECLARES ownership,
   * Class→Method DEFINES, IMPORTS (File→File | File→Dependency), EXPORTS
   * (File→symbol, re-exports File→File), EXTENDS/IMPLEMENTS from resolved
   * heritage references. Requires all involved nodes to exist (run after
   * writeParsedFile for every file, and after resolveReferences).
   */
  async writeStructuralEdges(parsed: ParsedFile, resolveModule: ModuleResolver): Promise<void> {
    const fileId = `${parsed.repo}:${parsed.path}`;

    // Ownership: DEFINES for definitions, DECLARES for variables.
    const defines: { b: string; bLabel: string }[] = [];
    const declares: { b: string; bLabel: string }[] = [];
    const byQualified = new Map(parsed.symbols.map((s) => [s.qualifiedName, s]));
    const classMethods: { a: string; b: string }[] = [];
    for (const symbol of parsed.symbols) {
      const label = KIND_LABEL[symbol.kind];
      if (symbol.kind === 'variable') declares.push({ b: symbol.id, bLabel: label });
      else defines.push({ b: symbol.id, bLabel: label });
      if (symbol.kind === 'method' && symbol.qualifiedName.includes('.')) {
        const className = symbol.qualifiedName.slice(0, symbol.qualifiedName.lastIndexOf('.'));
        const cls = byQualified.get(className);
        if (cls) classMethods.push({ a: cls.id, b: symbol.id });
      }
    }
    await this.edgeBatch('File', 'DEFINES', defines, fileId);
    await this.edgeBatch('File', 'DECLARES', declares, fileId);
    if (classMethods.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a:Class {id: row.a}), (b:Method {id: row.b})
         MERGE (a)-[:DEFINES]->(b)`,
        { rows: classMethods },
      );
    }

    // IMPORTS: resolved relative imports → File; package imports → Dependency.
    const fileImports: { b: string; props: Record<string, unknown> }[] = [];
    const depImports: { dep: string; name: string; props: Record<string, unknown> }[] = [];
    for (const imp of parsed.imports) {
      const props = {
        specifiers: JSON.stringify(imp.specifiers),
        kind: imp.kind,
        line: imp.line,
      };
      const target =
        imp.sourceType === 'relative' ? resolveModule(parsed.path, imp.source) : undefined;
      if (target) {
        fileImports.push({ b: `${parsed.repo}:${target}`, props });
      } else if (imp.sourceType !== 'relative') {
        const pkg = imp.source.startsWith('node:')
          ? imp.source
          : imp.source.split('/')[0]?.startsWith('@')
            ? imp.source.split('/').slice(0, 2).join('/')
            : (imp.source.split('/')[0] ?? imp.source);
        depImports.push({
          dep: `${parsed.repo}::dep::${pkg}`,
          name: pkg,
          props: { ...props, builtin: imp.sourceType === 'builtin' },
        });
      }
    }
    if (fileImports.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a:File {id: $fileId}), (b:File {id: row.b})
         MERGE (a)-[r:IMPORTS]->(b) SET r += row.props`,
        { fileId, rows: fileImports },
      );
    }
    if (depImports.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MERGE (d:Dependency {id: row.dep})
         SET d.repoId = $repo, d.name = row.name
         WITH d, row
         MATCH (a:File {id: $fileId})
         MERGE (a)-[r:IMPORTS]->(d) SET r += row.props`,
        { fileId, repo: parsed.repo, rows: depImports },
      );
    }

    // EXPORTS: local symbols; re-exports/star point at the source File.
    const exportRows: { b: string; bLabel: string; props: Record<string, unknown> }[] = [];
    for (const exp of parsed.exports) {
      const props = { exportKind: exp.kind, name: exp.name, line: exp.line };
      if (exp.kind === 'named' || exp.kind === 'default') {
        const local = exp.local ?? exp.name;
        const symbol = byQualified.get(local) ?? parsed.symbols.find((s) => s.name === local);
        if (symbol) {
          exportRows.push({ b: symbol.id, bLabel: KIND_LABEL[symbol.kind], props });
        }
      } else if (exp.source) {
        const target = resolveModule(parsed.path, exp.source);
        if (target) exportRows.push({ b: `${parsed.repo}:${target}`, bLabel: 'File', props });
      }
    }
    const exportsByLabel = new Map<string, typeof exportRows>();
    for (const row of exportRows) {
      const rows = exportsByLabel.get(row.bLabel) ?? [];
      rows.push(row);
      exportsByLabel.set(row.bLabel, rows);
    }
    for (const [label, rows] of exportsByLabel) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a:File {id: $fileId}), (b:${assertLabel(label)} {id: row.b})
         MERGE (a)-[r:EXPORTS {name: row.props.name}]->(b) SET r += row.props`,
        { fileId, rows },
      );
    }

    // EXTENDS / IMPLEMENTS from resolved heritage references.
    for (const kind of ['extends', 'implements'] as const) {
      const rows = parsed.references
        .filter((r) => r.kind === kind && r.resolvedId && r.from)
        .map((r) => {
          const from = byQualified.get(r.from ?? '');
          return from ? { a: from.id, b: r.resolvedId } : undefined;
        })
        .filter((r): r is { a: string; b: string } => r !== undefined);
      if (rows.length === 0) continue;
      const edge = kind === 'extends' ? 'EXTENDS' : 'IMPLEMENTS';
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a {id: row.a}), (b {id: row.b})
         MERGE (a)-[:${edge}]->(b)`,
        { rows },
      );
    }
  }

  /**
   * Behavioral edges for one file (issue #25): CALLS with per-pair counts,
   * WRITES, READS (targets that are Variables), USES (Enum/TypeAlias/Context
   * targets). Only resolved references produce edges — unresolved ones heal
   * on the next resolution pass when their target file gets indexed.
   */
  async writeBehavioralEdges(parsed: ParsedFile): Promise<void> {
    const byQualified = new Map(parsed.symbols.map((s) => [s.qualifiedName, s]));

    const calls = new Map<string, { a: string; b: string; line: number; count: number }>();
    const writes: { a: string; b: string; line: number }[] = [];
    const reads: { a: string; b: string; line: number }[] = [];

    for (const ref of parsed.references) {
      if (!ref.resolvedId || !ref.from) continue;
      const from = byQualified.get(ref.from);
      if (!from || from.id === ref.resolvedId) continue;
      if (ref.kind === 'call') {
        const key = `${from.id}|${ref.resolvedId}`;
        const existing = calls.get(key);
        if (existing) existing.count += 1;
        else calls.set(key, { a: from.id, b: ref.resolvedId, line: ref.line, count: 1 });
      } else if (ref.kind === 'write') {
        writes.push({ a: from.id, b: ref.resolvedId, line: ref.line });
      } else if (ref.kind === 'read') {
        reads.push({ a: from.id, b: ref.resolvedId, line: ref.line });
      }
    }

    if (calls.size > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a {id: row.a}), (b {id: row.b})
         MERGE (a)-[r:CALLS]->(b) SET r.line = row.line, r.count = row.count`,
        { rows: [...calls.values()] },
      );
    }
    if (writes.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a {id: row.a}), (b {id: row.b})
         MERGE (a)-[r:WRITES]->(b) SET r.line = row.line`,
        { rows: writes },
      );
    }
    if (reads.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a {id: row.a}), (b:Variable {id: row.b})
         MERGE (a)-[r:READS]->(b) SET r.line = row.line`,
        { rows: reads },
      );
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a {id: row.a}), (b {id: row.b})
         WHERE b:Enum OR b:TypeAlias OR b:Context
         MERGE (a)-[r:USES]->(b) SET r.line = row.line`,
        { rows: reads },
      );
    }
  }

  private async edgeBatch(
    aLabel: string,
    edge: string,
    rows: { b: string; bLabel: string }[],
    aId: string,
  ): Promise<void> {
    const byLabel = new Map<string, string[]>();
    for (const row of rows) {
      const list = byLabel.get(row.bLabel) ?? [];
      list.push(row.b);
      byLabel.set(row.bLabel, list);
    }
    for (const [label, ids] of byLabel) {
      await this.client.run(
        `UNWIND $ids AS id
         MATCH (a:${assertLabel(aLabel)} {id: $aId}), (b:${assertLabel(label)} {id: id})
         MERGE (a)-[:${edge}]->(b)`,
        { aId, ids },
      );
    }
  }
}
