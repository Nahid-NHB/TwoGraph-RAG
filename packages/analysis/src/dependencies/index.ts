import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphClient } from '@twograph/graph';
import { z } from 'zod';

const DEP_KIND_FIELDS = [
  ['dependencies', 'prod'],
  ['devDependencies', 'dev'],
  ['peerDependencies', 'peer'],
  ['optionalDependencies', 'optional'],
] as const;

type DepKind = (typeof DEP_KIND_FIELDS)[number][1];

/** Config kinds enumerated per docs/05-graph-schema.md's Configuration node. */
const CONFIG_PATTERNS: { configKind: string; files: string[] }[] = [
  { configKind: 'tsconfig', files: ['tsconfig.json'] },
  { configKind: 'vite', files: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'] },
  { configKind: 'next', files: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
  {
    configKind: 'webpack',
    files: ['webpack.config.js', 'webpack.config.ts', 'webpack.config.cjs'],
  },
  { configKind: 'rollup', files: ['rollup.config.js', 'rollup.config.mjs', 'rollup.config.ts'] },
  {
    configKind: 'eslint',
    files: [
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc',
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.ts',
    ],
  },
  {
    configKind: 'prettier',
    files: [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.js',
      'prettier.config.js',
      'prettier.config.mjs',
    ],
  },
];

interface PackageManifest {
  path: string;
  name: string;
  version: string | undefined;
  deps: { name: string; versionRange: string; kind: DepKind }[];
}

interface RawPackageJson {
  name?: string;
  version?: string;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readManifest(rootPath: string, relDir: string): PackageManifest | undefined {
  const pkgPath = join(rootPath, relDir, 'package.json');
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as RawPackageJson;
    const deps: PackageManifest['deps'] = [];
    for (const [field, kind] of DEP_KIND_FIELDS) {
      for (const [name, versionRange] of Object.entries(pkg[field] ?? {})) {
        deps.push({ name, versionRange, kind });
      }
    }
    return { path: relDir, name: pkg.name ?? relDir, version: pkg.version, deps };
  } catch {
    return undefined;
  }
}

/** Only the common one-level `"dir/*"` workspace glob form — covers npm/pnpm/yarn's typical layout. */
function resolveWorkspaceDirs(rootPath: string, patterns: readonly string[]): string[] {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) continue;
    const prefix = pattern.slice(0, -2);
    const base = join(rootPath, prefix);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`${prefix}/${entry.name}`);
    }
  }
  return dirs;
}

function collectManifests(rootPath: string): PackageManifest[] {
  const root = readManifest(rootPath, '.');
  if (!root) return [];
  const manifests = [root];
  const rawWorkspaces = (
    JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf8')) as RawPackageJson
  ).workspaces;
  const patterns = Array.isArray(rawWorkspaces) ? rawWorkspaces : (rawWorkspaces?.packages ?? []);
  for (const dir of resolveWorkspaceDirs(rootPath, patterns)) {
    const member = readManifest(rootPath, dir);
    if (member) manifests.push(member);
  }
  return manifests;
}

export interface DependencyGraphSummary {
  packages: number;
  dependencies: number;
  configurations: number;
}

/**
 * Parses package.json (+ npm/pnpm/yarn workspaces) and detects config files
 * (issue #68), writing Package/Dependency/Configuration nodes and DEPENDS_ON
 * edges. Dependency nodes use the same `${repo}::dep::${name}` id the
 * indexer already mints from observed imports (`packages/graph/src/writer.ts`),
 * so a declared dependency and its actual usage merge onto one node —
 * `declared` (set here) vs. incoming IMPORTS edges (set by the indexer) is
 * exactly the signal `findDependencyMismatches` needs.
 */
export async function writeDependencyGraph(
  client: GraphClient,
  repo: string,
  rootPath: string,
): Promise<DependencyGraphSummary> {
  const manifests = collectManifests(rootPath);
  let dependencies = 0;

  for (const manifest of manifests) {
    const packageId = `${repo}::package::${manifest.path}`;
    await client.run(
      `MERGE (p:Package {id: $id})
       SET p.repoId = $repo, p.name = $name, p.path = $path, p.version = $version`,
      {
        id: packageId,
        repo,
        name: manifest.name,
        path: manifest.path,
        version: manifest.version ?? null,
      },
    );
    for (const dep of manifest.deps) {
      await client.run(
        `MERGE (d:Dependency {id: $depId})
         SET d.repoId = $repo, d.name = $name, d.declared = true, d.depKind = $kind, d.versionRange = $versionRange
         WITH d
         MATCH (p:Package {id: $packageId})
         MERGE (p)-[r:DEPENDS_ON]->(d)
         SET r.versionRange = $versionRange`,
        {
          depId: `${repo}::dep::${dep.name}`,
          repo,
          name: dep.name,
          kind: dep.kind,
          versionRange: dep.versionRange,
          packageId,
        },
      );
      dependencies++;
    }
  }

  const scanDirs = ['.', ...manifests.filter((m) => m.path !== '.').map((m) => m.path)];
  const seen = new Set<string>();
  let configurations = 0;
  for (const dir of scanDirs) {
    for (const { configKind, files } of CONFIG_PATTERNS) {
      for (const file of files) {
        const relPath = dir === '.' ? file : `${dir}/${file}`;
        if (seen.has(relPath) || !existsSync(join(rootPath, relPath))) continue;
        seen.add(relPath);
        await client.run(
          `MERGE (c:Configuration {id: $id}) SET c.repoId = $repo, c.path = $path, c.configKind = $kind`,
          { id: `${repo}:${relPath}`, repo, path: relPath, kind: configKind },
        );
        configurations++;
      }
    }
  }

  return { packages: manifests.length, dependencies, configurations };
}

export const dependencyMismatchSchema = z.object({
  name: z.string(),
  kind: z.enum(['unused', 'phantom']),
  depKind: z.string().nullable(),
  importCount: z.number(),
});
export type DependencyMismatch = z.infer<typeof dependencyMismatchSchema>;

/**
 * Unused: declared in a package.json but never imported anywhere in the
 * indexed code. Phantom: imported somewhere but never declared in any
 * package.json (works only by accident, e.g. hoisting in a monorepo).
 * Requires `writeDependencyGraph` to have run at least once so `declared`
 * is set on the dependencies actually in package.json.
 */
export async function findDependencyMismatches(
  client: GraphClient,
  repo: string,
): Promise<DependencyMismatch[]> {
  const rows = await client.run(
    `MATCH (d:Dependency {repoId: $repo})
     OPTIONAL MATCH (f)-[:IMPORTS]->(d)
     RETURN d.name AS name, d.declared AS declared, d.depKind AS depKind, count(f) AS importCount`,
    { repo },
  );

  const mismatches: DependencyMismatch[] = [];
  for (const row of rows) {
    const name = row.get('name') as string;
    if (name.startsWith('node:')) continue; // built-ins never need a package.json entry
    const declared = row.get('declared') as boolean | null;
    const depKind = row.get('depKind') as string | null;
    const importCount = row.get('importCount') as number;
    if (declared && importCount === 0) {
      mismatches.push({ name, kind: 'unused', depKind, importCount });
    } else if (!declared && importCount > 0) {
      mismatches.push({ name, kind: 'phantom', depKind, importCount });
    }
  }
  return mismatches;
}

export const dependencyNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  depKind: z.string().nullable(),
  declared: z.boolean(),
  /** Version range as declared in package.json (e.g. `^18.2.0`) — null for a
   * phantom dependency that's only ever been observed via IMPORTS. */
  versionRange: z.string().nullable(),
  importCount: z.number(),
});

export const packageNodeSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  version: z.string().nullable(),
});

export const configurationNodeSchema = z.object({
  path: z.string(),
  configKind: z.string(),
});

/** A package→dependency DEPENDS_ON edge (issue #62's deps graph view). */
export const dependencyEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  versionRange: z.string().nullable(),
});

export const dependencyReportSchema = z.object({
  packages: z.array(packageNodeSchema),
  dependencies: z.array(dependencyNodeSchema),
  edges: z.array(dependencyEdgeSchema),
  configurations: z.array(configurationNodeSchema),
  mismatches: z.array(dependencyMismatchSchema),
});
export type DependencyReport = z.infer<typeof dependencyReportSchema>;

/** Writes the dependency/config graph fresh, then reports it back with mismatches (issue #68). */
export async function analyzeDependencies(
  client: GraphClient,
  repo: string,
  rootPath: string,
): Promise<DependencyReport> {
  await writeDependencyGraph(client, repo, rootPath);

  const [packageRows, dependencyRows, edgeRows, configRows, mismatches] = await Promise.all([
    client.run(
      `MATCH (p:Package {repoId: $repo}) RETURN p.id AS id, p.path AS path, p.name AS name, p.version AS version`,
      {
        repo,
      },
    ),
    client.run(
      `MATCH (d:Dependency {repoId: $repo})
       OPTIONAL MATCH (f)-[:IMPORTS]->(d)
       RETURN d.id AS id, d.name AS name, d.depKind AS depKind, d.declared AS declared,
              d.versionRange AS versionRange, count(f) AS importCount`,
      { repo },
    ),
    client.run(
      `MATCH (p:Package {repoId: $repo})-[r:DEPENDS_ON]->(d:Dependency)
       RETURN p.id AS from, d.id AS to, r.versionRange AS versionRange`,
      { repo },
    ),
    client.run(
      `MATCH (c:Configuration {repoId: $repo}) RETURN c.path AS path, c.configKind AS configKind`,
      {
        repo,
      },
    ),
    findDependencyMismatches(client, repo),
  ]);

  return {
    packages: packageRows.map((r) => ({
      id: r.get('id') as string,
      path: r.get('path') as string,
      name: r.get('name') as string,
      version: r.get('version') as string | null,
    })),
    dependencies: dependencyRows.map((r) => ({
      id: r.get('id') as string,
      name: r.get('name') as string,
      depKind: r.get('depKind') as string | null,
      declared: Boolean(r.get('declared')),
      versionRange: r.get('versionRange') as string | null,
      importCount: r.get('importCount') as number,
    })),
    edges: edgeRows.map((r) => ({
      from: r.get('from') as string,
      to: r.get('to') as string,
      versionRange: r.get('versionRange') as string | null,
    })),
    configurations: configRows.map((r) => ({
      path: r.get('path') as string,
      configKind: r.get('configKind') as string,
    })),
    mismatches,
  };
}
