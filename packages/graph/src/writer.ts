import { formatSymbolId, type CodeSymbol, type ParsedFile, type SymbolKind } from '@twograph/core';
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
      // Route→handler links become HANDLES edges (writeReactEdges), not CALLS.
      if (from.kind === 'route') continue;
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

  /**
   * React-specific edges (issue #26): USES_COMPONENT (JSX usage with counts),
   * USES_HOOK, PROVIDES_CONTEXT (<X.Provider> renders), CONSUMES_CONTEXT
   * (useContext reads), and HANDLES (handler → Route).
   */
  async writeReactEdges(parsed: ParsedFile): Promise<void> {
    const byQualified = new Map(parsed.symbols.map((s) => [s.qualifiedName, s]));
    const routeIds = new Map(
      parsed.symbols.filter((s) => s.kind === 'route').map((s) => [s.qualifiedName, s.id]),
    );

    const usesComponent: { a: string; b: string; count: number }[] = [];
    const providesContext: { a: string; b: string }[] = [];
    const usesHook: { a: string; b: string; line: number }[] = [];
    const consumesContext: { a: string; b: string }[] = [];
    const handles: { handler: string; route: string }[] = [];

    for (const ref of parsed.references) {
      if (!ref.resolvedId || !ref.from) continue;
      const routeId = routeIds.get(ref.from);
      if (routeId) {
        handles.push({ handler: ref.resolvedId, route: routeId });
        continue;
      }
      const from = byQualified.get(ref.from);
      if (!from) continue;
      if (ref.kind === 'jsx') {
        if (ref.name.endsWith('.Provider')) {
          providesContext.push({ a: from.id, b: ref.resolvedId });
        } else {
          const jsxUsage = from.meta['jsxUsage'] as Record<string, number> | undefined;
          usesComponent.push({ a: from.id, b: ref.resolvedId, count: jsxUsage?.[ref.name] ?? 1 });
        }
      } else if (ref.kind === 'hook') {
        usesHook.push({ a: from.id, b: ref.resolvedId, line: ref.line });
      } else if (ref.kind === 'read') {
        consumesContext.push({ a: from.id, b: ref.resolvedId });
      }
    }

    if (usesComponent.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a {id: row.a}), (b:Component {id: row.b})
         MERGE (a)-[r:USES_COMPONENT]->(b) SET r.count = row.count`,
        { rows: usesComponent },
      );
    }
    if (providesContext.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a {id: row.a}), (b:Context {id: row.b})
         MERGE (a)-[:PROVIDES_CONTEXT]->(b)`,
        { rows: providesContext },
      );
    }
    if (usesHook.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a {id: row.a}), (b:Hook {id: row.b})
         MERGE (a)-[r:USES_HOOK]->(b) SET r.line = row.line`,
        { rows: usesHook },
      );
    }
    if (consumesContext.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (a {id: row.a}), (b:Context {id: row.b})
         MERGE (a)-[:CONSUMES_CONTEXT]->(b)`,
        { rows: consumesContext },
      );
    }
    if (handles.length > 0) {
      await this.client.run(
        `UNWIND $rows AS row
         MATCH (h {id: row.handler}), (r:Route {id: row.route})
         MERGE (h)-[:HANDLES]->(r)`,
        { rows: handles },
      );
    }
  }

  /**
   * Incremental update support (issue #27, docs/05 §3): removes a file's owned
   * subgraph so it can be rewritten. Route nodes are permanent — they keep
   * their identity/properties; only their inbound HANDLES edges are cleared
   * for re-pointing. The File node survives (or is deleted for removed files).
   */
  async removeFileSubgraph(
    repo: string,
    path: string,
    options: { deleteFile?: boolean } = {},
  ): Promise<void> {
    const fileId = `${repo}:${path}`;
    // Non-route symbols owned by the file: fully removed (incoming edges too).
    await this.client.run(
      `MATCH (f:File {id: $fileId})-[:CONTAINS]->(s)
       WHERE NOT s:Route
       DETACH DELETE s`,
      { fileId },
    );
    // Routes stay; clear inbound HANDLES so handlers re-point on rewrite.
    await this.client.run(
      `MATCH (f:File {id: $fileId})-[:CONTAINS]->(r:Route)<-[h:HANDLES]-()
       DELETE h`,
      { fileId },
    );
    // The file's own structural edges are rewritten from scratch.
    await this.client.run(
      `MATCH (f:File {id: $fileId})-[e:IMPORTS|EXPORTS|DEFINES|DECLARES]->()
       DELETE e`,
      { fileId },
    );
    if (options.deleteFile) {
      await this.client.run('MATCH (f:File {id: $fileId}) DETACH DELETE f', { fileId });
    }
  }

  /**
   * A renamed file is a delete (old path) + add (new path) to the indexer,
   * which — per `removeFileSubgraph`'s permanent-Route design — leaves the
   * old Route node orphaned while parsing the new path mints a fresh one
   * with a new (path-based) id. This merges that fresh duplicate back into
   * the surviving old node so the Route's identity survives the rename
   * (issue #66): re-point its CONTAINS/HANDLES edges onto the old node,
   * delete the duplicate, then re-key the old node's id/path to the new
   * location. Returns the number of routes migrated.
   */
  async migrateRenamedRoutes(repo: string, oldPath: string, newPath: string): Promise<number> {
    const oldPrefix = `${repo}:${oldPath}#`;
    const orphaned = await this.client.run(
      `MATCH (r:Route)
       WHERE r.id STARTS WITH $oldPrefix AND NOT exists(()-[:CONTAINS]->(r))
       RETURN r.id AS id`,
      { oldPrefix },
    );

    let migrated = 0;
    for (const row of orphaned) {
      const oldId = row.get('id') as string;
      const qualifiedName = oldId.slice(oldPrefix.length);
      const newId = formatSymbolId({ repo, path: newPath, qualifiedName });

      const fresh = await this.client.run(
        `MATCH (newR:Route {id: $newId}) RETURN properties(newR) AS props LIMIT 1`,
        { newId },
      );
      const freshRow = fresh[0];
      if (!freshRow) continue; // nothing re-created at the new path yet
      const freshProps = freshRow.get('props') as Record<string, unknown>;

      await this.client.run(
        `MATCH (newFile:File)-[c:CONTAINS]->(:Route {id: $newId}), (oldR:Route {id: $oldId})
         MERGE (newFile)-[:CONTAINS]->(oldR)
         DELETE c`,
        { newId, oldId },
      );
      await this.client.run(
        `MATCH (h)-[hr:HANDLES]->(:Route {id: $newId}), (oldR:Route {id: $oldId})
         MERGE (h)-[:HANDLES]->(oldR)
         DELETE hr`,
        { newId, oldId },
      );
      // The duplicate must go before old.id is re-keyed to newId, or the two
      // nodes briefly share an id and {id: $newId} would match either.
      await this.client.run(`MATCH (newR:Route {id: $newId}) DETACH DELETE newR`, { newId });
      await this.client.run(
        `MATCH (oldR:Route {id: $oldId}) SET oldR += $props, oldR.id = $newId, oldR.path = $newPath`,
        { oldId, newId, newPath, props: freshProps },
      );
      migrated++;
    }
    return migrated;
  }

  /** All write passes for one file, in order. */
  async writeFileComplete(parsed: ParsedFile, resolveModule: ModuleResolver): Promise<void> {
    await this.writeParsedFile(parsed);
    await this.writeStructuralEdges(parsed, resolveModule);
    await this.writeBehavioralEdges(parsed);
    await this.writeReactEdges(parsed);
  }

  /**
   * Re-index one changed file: remove its subgraph, rewrite it, and re-run
   * edge passes for dependent files (whose edges into the removed symbols
   * were destroyed). Dependents are supplied by the caller (indexer keeps
   * parse results); returns the dependent paths it re-pointed.
   */
  async updateFile(
    parsed: ParsedFile,
    resolveModule: ModuleResolver,
    dependents: ParsedFile[],
  ): Promise<string[]> {
    await this.removeFileSubgraph(parsed.repo, parsed.path);
    await this.writeFileComplete(parsed, resolveModule);
    for (const dep of dependents) {
      await this.writeStructuralEdges(dep, resolveModule);
      await this.writeBehavioralEdges(dep);
      await this.writeReactEdges(dep);
    }
    return dependents.map((d) => d.path);
  }

  /** Paths of files that IMPORT the given file (need edge re-pointing). */
  async dependentFiles(repo: string, path: string): Promise<string[]> {
    const rows = await this.client.run(
      `MATCH (d:File {repoId: $repo})-[:IMPORTS]->(:File {id: $fileId})
       RETURN d.path AS path`,
      { repo, fileId: `${repo}:${path}` },
    );
    return rows.map((r) => r.get('path') as string);
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
