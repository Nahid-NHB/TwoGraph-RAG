import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedFile } from '@twograph/core';
import { createModuleResolver, ParserEngine, resolveReferences } from '@twograph/parser';
import { bootstrapSchema, GraphClient, GraphWriter } from '@twograph/graph';

const REPO = 'rtest';
const URI = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const client = new GraphClient({ uri: URI });
const writer = new GraphWriter(client);
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
  for (const file of files) await writer.writeParsedFile(file);
  for (const file of files) {
    await writer.writeStructuralEdges(file, resolver);
    await writer.writeBehavioralEdges(file);
    await writer.writeReactEdges(file);
  }
}, 120_000);

afterAll(async () => {
  await wipe();
  await client.close();
});

describe('React edges', () => {
  it('USES_COMPONENT reflects JSX usage', async () => {
    const rows = await client.run(
      `MATCH (a:Component {name: 'UserList', repoId: $repo})-[r:USES_COMPONENT]->(b:Component)
       RETURN b.name AS name, r.count AS count`,
      { repo: REPO },
    );
    expect(
      rows.map((r) => ({ name: r.get('name') as string, count: r.get('count') as number })),
    ).toContainEqual({ name: 'UserCard', count: 1 });
  });

  it('USES_HOOK links components to custom hooks', async () => {
    const rows = await client.run(
      `MATCH (:Component {name: 'UserList', repoId: $repo})-[:USES_HOOK]->(h:Hook)
       RETURN collect(h.name) AS hooks`,
      { repo: REPO },
    );
    expect(rows[0]?.get('hooks')).toEqual(expect.arrayContaining(['useUsers', 'useDebounce']));
  });

  it('context flow: provider and consumers meet at the Context node (docs/05 canonical)', async () => {
    const rows = await client.run(
      `MATCH (p)-[:PROVIDES_CONTEXT]->(ctx:Context {repoId: $repo})<-[:CONSUMES_CONTEXT]-(c)
       RETURN p.name AS provider, ctx.name AS context, collect(DISTINCT c.name) AS consumers`,
      { repo: REPO },
    );
    expect(rows[0]?.get('provider')).toBe('AuthProvider');
    expect(rows[0]?.get('context')).toBe('AuthContext');
    expect(rows[0]?.get('consumers')).toContain('useAuth');
  });

  it('HANDLES links Express handlers to their routes', async () => {
    const rows = await client.run(
      `MATCH (h:Function {repoId: $repo})-[:HANDLES]->(r:Route {method: 'GET'})
       WHERE r.routePattern = '/api/users/:id'
       RETURN h.name AS handler`,
      { repo: REPO },
    );
    expect(rows[0]?.get('handler')).toBe('getUserHandler');
  });

  it('HANDLES links React Router routes to their page components', async () => {
    const rows = await client.run(
      `MATCH (c:Component {repoId: $repo})-[:HANDLES]->(r:Route {routePattern: '/users'})
       RETURN c.name AS name`,
      { repo: REPO },
    );
    expect(rows[0]?.get('name')).toBe('UsersPage');
  });

  it('finds unused React components (docs/05 canonical dead-code seed)', async () => {
    const rows = await client.run(
      `MATCH (c:Component {repoId: $repo})
       WHERE NOT exists(()-[:USES_COMPONENT]->(c)) AND NOT exists((c)-[:HANDLES]->(:Route))
       RETURN collect(c.name) AS unused`,
      { repo: REPO },
    );
    expect(rows[0]?.get('unused')).toContain('DeadBanner');
    expect(rows[0]?.get('unused')).not.toContain('UserCard');
  });
});
