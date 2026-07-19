import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedFile } from '@twograph/core';
import { createModuleResolver, ParserEngine, resolveReferences } from '@twograph/parser';
import {
  bootstrapSchema,
  GraphClient,
  GraphQueries,
  GraphWriter,
  runTemplate,
} from '@twograph/graph';

const REPO = 'qtest';
const URI = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const client = new GraphClient({ uri: URI });
const writer = new GraphWriter(client);
const queries = new GraphQueries(client);
const engine = new ParserEngine();
const ROOT = join(import.meta.dirname, '../../../../examples/sample-repo/src');

const wipe = () => client.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });

beforeAll(async () => {
  if (!(await client.healthcheck())) throw new Error(`Memgraph not reachable at ${URI}`);
  await bootstrapSchema(client);
  await wipe();
  const files: ParsedFile[] = [];
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
  const resolver = createModuleResolver(files.map((f) => f.path));
  await writer.ensureRepository({ id: REPO, name: 'sample', rootPath: ROOT });
  for (const f of files) await writer.writeParsedFile(f);
  for (const f of files) {
    await writer.writeStructuralEdges(f, resolver);
    await writer.writeBehavioralEdges(f);
    await writer.writeReactEdges(f);
  }
}, 120_000);

afterAll(async () => {
  await wipe();
  await client.close();
});

describe('typed graph queries', () => {
  it('callers walk upstream with depth', async () => {
    const callers = await queries.callers(REPO, `${REPO}:api/client.ts#fetchJson`, 2);
    expect(callers.map((c) => c.name)).toEqual(expect.arrayContaining(['fetchUser', 'fetchUsers']));
    expect(callers.every((c) => c.depth >= 1 && c.depth <= 2)).toBe(true);
  });

  it('callees walk downstream', async () => {
    const callees = await queries.callees(REPO, `${REPO}:auth/jwt.ts#verifyToken`, 1);
    expect(callees.map((c) => c.name)).toEqual(
      expect.arrayContaining(['validateJWT', 'decodeToken']),
    );
  });

  it('componentUsage returns rendering components', async () => {
    const usage = await queries.componentUsage(REPO, `${REPO}:components/UserCard.tsx#UserCard`);
    expect(usage.map((u) => u.name)).toContain('UserList');
  });

  it('neighbors are grouped by direction with edge types', async () => {
    const n = await queries.neighbors(REPO, `${REPO}:auth/jwt.ts#verifyToken`);
    expect(n.outgoing.map((o) => o.edge)).toContain('CALLS');
    expect(n.incoming.map((i) => i.edge)).toContain('DEFINES');
  });

  it('symbolDetail returns properties and NotFound for missing ids', async () => {
    const detail = await queries.symbolDetail(REPO, `${REPO}:auth/jwt.ts#verifyToken`);
    expect(detail).toMatchObject({ name: 'verifyToken', kind: 'Function' });
    await expect(queries.symbolDetail(REPO, `${REPO}:nope.ts#missing`)).rejects.toThrow();
  });

  it('subgraph export returns nodes and typed edges', async () => {
    const sub = await queries.subgraph(
      REPO,
      `${REPO}:components/UserList.tsx#UserList`,
      ['CALLS', 'USES_COMPONENT', 'USES_HOOK'],
      2,
    );
    expect(sub.nodes.length).toBeGreaterThan(2);
    expect(sub.edges).toContainEqual(expect.objectContaining({ type: 'USES_COMPONENT' }));
  });

  it('dependentFiles follows both IMPORTS and EXPORTS (barrel re-export) edges', async () => {
    const dependents = await queries.dependentFiles(REPO, 'auth/jwt.ts');
    expect(dependents).toEqual(expect.arrayContaining(['api/handlers.ts', 'auth/authService.ts']));

    // utils/index.ts re-exports everything from utils/format.ts via `export *
    // from` — a barrel edge, not an import — so it must show up too.
    const utilsDependents = await queries.dependentFiles(REPO, 'utils/format.ts');
    expect(utilsDependents).toContain('utils/index.ts');
  });

  it('filePaths lists the repository files', async () => {
    const paths = await queries.filePaths(REPO);
    expect(paths).toContain('auth/jwt.ts');
    expect(paths.length).toBeGreaterThanOrEqual(20);
  });

  it('shortestPath connects UI to API layer', async () => {
    const path = await queries.shortestPath(
      REPO,
      `${REPO}:components/UserList.tsx#UserList`,
      `${REPO}:api/client.ts#fetchJson`,
    );
    expect(path).not.toBeNull();
    expect(path?.nodeIds[0]).toBe(`${REPO}:components/UserList.tsx#UserList`);
    expect(path?.nodeIds.at(-1)).toBe(`${REPO}:api/client.ts#fetchJson`);
  });

  it('templates run end-to-end', async () => {
    const deps = await runTemplate(client, 'files_depending_on', {
      repo: REPO,
      dependency: 'axios',
    });
    expect(deps).toEqual([{ path: 'api/client.ts' }]);
    const unused = await runTemplate(client, 'unused_components', { repo: REPO });
    expect(unused.map((u) => u['name'])).toContain('DeadBanner');
    const routes = await runTemplate(client, 'routes', { repo: REPO });
    expect(routes.length).toBeGreaterThanOrEqual(7);
  });
});
