import type { GraphClient } from '@twograph/graph';
import { z } from 'zod';

/** Reachability travels the same "real usage" edges the graph already models. */
const REACHABILITY_EDGES = 'CALLS|IMPORTS|USES_COMPONENT|USES_HOOK';

/** Declaration kinds precise enough to check for a direct incoming usage edge. */
const CHECKED_KINDS = ['Function', 'Component', 'Hook'] as const;

const DEFAULT_ENTRY_FILES = [
  'src/main.ts',
  'src/main.tsx',
  'src/index.ts',
  'src/index.tsx',
  'src/App.tsx',
  'main.ts',
  'main.tsx',
  'index.ts',
  'index.tsx',
  'index.js',
  'App.tsx',
];

const DEFAULT_TEST_PATTERN = /(^|\/)(__tests__\/.*|.*\.(test|spec)\.[jt]sx?)$/;

export const deadCodeConfidenceSchema = z.enum(['dead', 'possibly-used']);

export const deadCodeSymbolSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  path: z.string(),
  confidence: deadCodeConfidenceSchema,
});

export const deadCodeFileSchema = z.object({
  id: z.string(),
  path: z.string(),
  confidence: deadCodeConfidenceSchema,
});

export const deadCodeReportSchema = z.object({
  entryPoints: z.array(z.string()),
  symbols: z.array(deadCodeSymbolSchema),
  files: z.array(deadCodeFileSchema),
});

export type DeadCodeReport = z.infer<typeof deadCodeReportSchema>;

export interface FindDeadCodeOptions {
  /** Repo-relative paths whose exported symbols seed the reachability walk. Falls back to common entry-file names. */
  entryPointPaths?: string[];
  /** Also treat every symbol defined in a test file as a root (issue #67: "routes, tests optionally"). */
  includeTests?: boolean;
  testFilePattern?: RegExp;
}

/**
 * Reachability-based dead-code report (issue #67): BFS from Route/Api nodes
 * and configured (or heuristically detected) entry-point files over
 * CALLS/IMPORTS/USES_COMPONENT/USES_HOOK edges. Anything of a checkable kind
 * never reached is reported dead, unless its file is also reachable only via
 * a dynamic `import()` — those are downgraded to "possibly-used" since a
 * dynamically-computed target can't always be proven reachable statically.
 *
 * Unlike the file-level check (a file is dead only if nothing imports it,
 * transitively), the symbol-level check requires a direct usage edge — a
 * file can be reachable (imported for its types) while a specific function
 * inside it is still genuinely unused.
 */
export async function findDeadCode(
  client: GraphClient,
  repo: string,
  options: FindDeadCodeOptions = {},
): Promise<DeadCodeReport> {
  const entryPaths = options.entryPointPaths ?? DEFAULT_ENTRY_FILES;

  const rootRows = await client.run(
    // Entry-point files' own exports seed the walk directly. Their top-level
    // script code (e.g. `createRoot(...).render(<App/>)`) isn't inside any
    // symbol the parser attributes JSX/call usage to, so what they import is
    // seeded as roots too — otherwise the very first component/function an
    // entry file hands off to would always read as unreachable.
    `MATCH (n {repoId: $repo})
     WHERE n:Route OR n:Api OR (n.exported = true AND n.path IN $entryPaths)
     RETURN n.id AS id
     UNION
     MATCH (ef:File {repoId: $repo})-[:IMPORTS]->(target:File)-[:DEFINES]->(s)
     WHERE ef.path IN $entryPaths AND s.exported = true
     RETURN s.id AS id
     UNION
     // HANDLES points handler->Route, the opposite direction the walk goes
     // in (root->...->reached), so a route's own handler needs to be seeded
     // as a root directly rather than discovered by the walk.
     MATCH (h)-[:HANDLES]->(r {repoId: $repo})
     WHERE r:Route OR r:Api
     RETURN h.id AS id`,
    { repo, entryPaths },
  );
  let rootIds = rootRows.map((r) => r.get('id') as string);

  if (options.includeTests) {
    const testPattern = options.testFilePattern ?? DEFAULT_TEST_PATTERN;
    const fileRows = await client.run(`MATCH (f:File {repoId: $repo}) RETURN f.path AS path`, {
      repo,
    });
    const testPaths = fileRows
      .map((r) => r.get('path') as string)
      .filter((p) => testPattern.test(p));
    if (testPaths.length > 0) {
      const testSymbolRows = await client.run(
        `MATCH (s {repoId: $repo}) WHERE s.path IN $paths RETURN s.id AS id`,
        { repo, paths: testPaths },
      );
      rootIds = [...rootIds, ...testSymbolRows.map((r) => r.get('id') as string)];
    }
  }

  if (rootIds.length === 0) {
    // No detectable entry points — every declaration would trivially read as
    // "dead," which isn't a useful signal. Report nothing rather than noise.
    return { entryPoints: [], symbols: [], files: [] };
  }

  const reachedRows = await client.run(
    `UNWIND $rootIds AS rid
     MATCH (root {id: rid})
     MATCH (root)-[:${REACHABILITY_EDGES}*BFS]->(n)
     RETURN DISTINCT n.id AS id`,
    { rootIds },
  );
  const reached = new Set<string>([...rootIds, ...reachedRows.map((r) => r.get('id') as string)]);

  const dynamicallyImportedFiles = await client.run(
    `MATCH (x)-[r:IMPORTS]->(f:File {repoId: $repo}) WHERE r.kind = 'dynamic' RETURN DISTINCT f.id AS id`,
    { repo },
  );
  const dynamicTargets = new Set(dynamicallyImportedFiles.map((r) => r.get('id') as string));

  const kindUnion = CHECKED_KINDS.map(
    (kind) =>
      `MATCH (s:${kind} {repoId: $repo}) RETURN s.id AS id, s.name AS name, s.path AS path, '${kind}' AS kind`,
  ).join('\nUNION\n');
  const declRows = await client.run(kindUnion, { repo });

  const symbols = declRows
    .map((r) => ({
      id: r.get('id') as string,
      name: r.get('name') as string,
      kind: r.get('kind') as string,
      path: r.get('path') as string,
    }))
    .filter((s) => !reached.has(s.id))
    .map((s) => ({
      ...s,
      confidence: dynamicTargets.has(`${repo}:${s.path}`)
        ? ('possibly-used' as const)
        : ('dead' as const),
    }));

  // A file is dead if the file node itself was never reached (e.g. nothing
  // imports it) AND none of its own checkable declarations were reached
  // either — most usage edges (CALLS/USES_COMPONENT/USES_HOOK) land on the
  // *symbol*, not the file, so checking only the file node would flag any
  // file whose sole usage signal is "something calls a function defined in
  // it." Only the same kinds `CHECKED_KINDS` covers count as "checkable" —
  // interfaces/type aliases/enums/plain variables have no usage-edge
  // mechanism at all in this graph (type references and value reads aren't
  // modeled), so a file containing only those falls back to whether the
  // file node itself is reached (i.e. is it still imported by something).
  const fileRows = await client.run(
    `MATCH (f:File {repoId: $repo})
     OPTIONAL MATCH (f)-[:DEFINES|DECLARES]->(s)
     WHERE s:${CHECKED_KINDS.join(' OR s:')}
     RETURN f.id AS id, f.path AS path, collect(s.id) AS symbolIds`,
    { repo },
  );
  const files = fileRows
    .map((r) => ({
      id: r.get('id') as string,
      path: r.get('path') as string,
      symbolIds: r.get('symbolIds') as string[],
    }))
    // Entry-point files are roots by policy even though nothing in-repo
    // imports them — the runtime/bundler invokes them directly.
    .filter((f) => !entryPaths.includes(f.path))
    .filter(
      (f) =>
        f.symbolIds.length > 0 && !reached.has(f.id) && !f.symbolIds.some((id) => reached.has(id)),
    )
    .map((f) => ({
      id: f.id,
      path: f.path,
      confidence: dynamicTargets.has(f.id) ? ('possibly-used' as const) : ('dead' as const),
    }));

  return { entryPoints: rootIds, symbols, files };
}
