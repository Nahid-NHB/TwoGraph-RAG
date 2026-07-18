import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedFile } from '@twograph/core';
import { createModuleResolver, ParserEngine, resolveReferences } from '@twograph/parser';
import { bootstrapSchema, GraphClient, GraphWriter } from '@twograph/graph';

const REPO = 'itest';
const URI = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const client = new GraphClient({ uri: URI });
const writer = new GraphWriter(client);
const engine = new ParserEngine();
const ROOT = join(import.meta.dirname, '../../../../examples/sample-repo/src');

let files: ParsedFile[] = [];
const byPath = () => new Map(files.map((f) => [f.path, f]));
const resolver = () => createModuleResolver(files.map((f) => f.path));

const wipe = () => client.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
const total = async (): Promise<number> => {
  const rows = await client.run('MATCH (n {repoId: $repo}) RETURN count(n) AS c', { repo: REPO });
  return rows[0]?.get('c') as number;
};

beforeAll(async () => {
  if (!(await client.healthcheck())) throw new Error(`Memgraph not reachable at ${URI}`);
  await bootstrapSchema(client);
  await wipe();

  const walk = async (dir: string): Promise<void> => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) await walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        files.push(await engine.parseFile(REPO, relative(ROOT, full), readFileSync(full, 'utf8')));
      }
    }
  };
  await walk(ROOT);
  resolveReferences(files);
  await writer.ensureRepository({ id: REPO, name: 'sample', rootPath: ROOT });
  for (const f of files) await writer.writeParsedFile(f);
  const r = resolver();
  for (const f of files) {
    await writer.writeStructuralEdges(f, r);
    await writer.writeBehavioralEdges(f);
    await writer.writeReactEdges(f);
  }
}, 120_000);

afterAll(async () => {
  await wipe();
  await client.close();
});

async function reindexPath(path: string): Promise<void> {
  const parsed = byPath().get(path);
  if (!parsed) throw new Error(`not parsed: ${path}`);
  const depPaths = await writer.dependentFiles(REPO, path);
  const deps = depPaths.map((p) => byPath().get(p)).filter((f): f is ParsedFile => !!f);
  await writer.updateFile(parsed, resolver(), deps);
}

describe('incremental graph updates', () => {
  it('re-indexing one file leaves total graph size stable', async () => {
    const before = await total();
    await reindexPath('auth/authService.ts');
    expect(await total()).toBe(before);
  });

  it('does not touch unrelated subgraphs', async () => {
    const probe = async (): Promise<number | undefined> =>
      (
        await client.run(
          `MATCH (c:Component {name: 'UserCard', repoId: $repo}) RETURN id(c) AS internal`,
          { repo: REPO },
        )
      )[0]?.get('internal') as number | undefined;
    const before = await probe();
    await reindexPath('auth/jwt.ts');
    expect(await probe()).toEqual(before);
  });

  it('re-points cross-file edges into recreated symbols', async () => {
    await reindexPath('api/client.ts');
    const rows = await client.run(
      `MATCH (caller)-[:CALLS]->(f:Function {name: 'fetchJson', repoId: $repo})
       RETURN collect(caller.name) AS callers`,
      { repo: REPO },
    );
    expect(rows[0]?.get('callers')).toEqual(expect.arrayContaining(['fetchUser', 'fetchUsers']));
  });

  it('Route nodes survive handler-file reindex with identity intact', async () => {
    const internalId = async (): Promise<number | undefined> =>
      (
        await client.run(
          `MATCH (r:Route {repoId: $repo, routePattern: '/api/users/:id'}) RETURN id(r) AS i`,
          { repo: REPO },
        )
      )[0]?.get('i') as number | undefined;
    const before = await internalId();
    expect(before).toBeDefined();
    await reindexPath('api/server.ts');
    expect(await internalId()).toEqual(before);
    // HANDLES re-pointed after rewrite.
    const handles = await client.run(
      `MATCH (h)-[:HANDLES]->(r:Route {repoId: $repo, routePattern: '/api/users/:id'})
       RETURN h.name AS n`,
      { repo: REPO },
    );
    expect(handles[0]?.get('n')).toBe('getUserHandler');
  });

  it('edited content replaces symbols precisely', async () => {
    const edited = await engine.parseFile(
      REPO,
      'utils/format.ts',
      [
        '/** Formats an ISO date for display. */',
        'export function formatDate(iso: string): string {',
        '  return new Date(iso).toLocaleDateString();',
        '}',
        'export function formatNameShort(fullName: string): string {',
        '  return fullName.split(" ")[0] ?? fullName;',
        '}',
      ].join('\n'),
    );
    files = files.map((f) => (f.path === 'utils/format.ts' ? edited : f));
    resolveReferences(files);
    await reindexPath('utils/format.ts');

    const names = await client.run(
      `MATCH (:File {id: $f})-[:DEFINES]->(s) RETURN collect(s.name) AS names`,
      { f: `${REPO}:utils/format.ts` },
    );
    expect(names[0]?.get('names')).toEqual(
      expect.arrayContaining(['formatDate', 'formatNameShort']),
    );
    expect(names[0]?.get('names')).not.toContain('toCsvRow');
  }, 30_000);

  it('stress: 25 sequential re-indexes keep the graph stable', async () => {
    const before = await total();
    for (let i = 0; i < 25; i++) await reindexPath('auth/jwt.ts');
    expect(await total()).toBe(before);
  }, 120_000);
});
