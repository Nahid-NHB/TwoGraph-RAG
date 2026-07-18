import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedFile } from '@twograph/core';
import { createModuleResolver, ParserEngine, resolveReferences } from '@twograph/parser';
import { bootstrapSchema, GraphClient, GraphWriter } from '@twograph/graph';

const REPO = 'btest';
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
  // Synthetic file exercising module-variable writes.
  files.push(
    await engine.parseFile(
      REPO,
      'state/counter.ts',
      ['export let counter = 0;', 'export function inc() { counter += 1; return counter; }'].join(
        '\n',
      ),
    ),
  );
  resolveReferences(files);
  const resolver = createModuleResolver(files.map((f) => f.path));

  await writer.ensureRepository({ id: REPO, name: 'sample', rootPath: ROOT });
  for (const file of files) await writer.writeParsedFile(file);
  for (const file of files) {
    await writer.writeStructuralEdges(file, resolver);
    await writer.writeBehavioralEdges(file);
  }
}, 120_000);

afterAll(async () => {
  await wipe();
  await client.close();
});

describe('behavioral edges', () => {
  it('CALLS within a file', async () => {
    const rows = await client.run(
      `MATCH (:Function {name: 'verifyToken', repoId: $repo})-[:CALLS]->(t)
       RETURN collect(t.name) AS callees`,
      { repo: REPO },
    );
    expect(rows[0]?.get('callees')).toEqual(expect.arrayContaining(['validateJWT', 'decodeToken']));
  });

  it('CALLS across files (docs/05 canonical: who calls fetchJson?)', async () => {
    const rows = await client.run(
      `MATCH (caller)-[:CALLS]->(f:Function {name: 'fetchJson', repoId: $repo})
       RETURN collect(caller.name) AS callers`,
      { repo: REPO },
    );
    expect(rows[0]?.get('callers')).toEqual(
      expect.arrayContaining(['fetchUser', 'fetchUsers', 'updateUser', 'authenticateUser']),
    );
  });

  it('method-to-function and this-method CALLS', async () => {
    const rows = await client.run(
      `MATCH (m:Method {qualifiedName: 'AuthService.login', repoId: $repo})-[:CALLS]->(t)
       RETURN collect(t.name) AS callees`,
      { repo: REPO },
    );
    expect(rows[0]?.get('callees')).toEqual(expect.arrayContaining(['authenticateUser']));
  });

  it('READS and WRITES on module variables', async () => {
    const reads = await client.run(
      `MATCH (f:Function {name: 'fetchJson', repoId: $repo})-[:READS]->(v:Variable)
       RETURN collect(v.name) AS vars`,
      { repo: REPO },
    );
    expect(reads[0]?.get('vars')).toContain('API_BASE');
    const writes = await client.run(
      `MATCH (f:Function {name: 'inc', repoId: $repo})-[:WRITES]->(v:Variable {name: 'counter'})
       RETURN count(*) AS c`,
      { repo: REPO },
    );
    expect(writes[0]?.get('c')).toBe(1);
  });

  it('USES for context reads', async () => {
    const rows = await client.run(
      `MATCH (h:Hook {name: 'useAuth', repoId: $repo})-[:USES]->(c:Context)
       RETURN c.name AS name`,
      { repo: REPO },
    );
    expect(rows[0]?.get('name')).toBe('AuthContext');
  });

  it('aggregates call counts per caller/callee pair', async () => {
    const rows = await client.run(
      `MATCH (:Function {name: 'verifyToken', repoId: $repo})-[r:CALLS]->(:Function {name: 'validateJWT', repoId: $repo})
       RETURN r.count AS c`,
      { repo: REPO },
    );
    expect(rows[0]?.get('c')).toBe(1);
    expect(rows).toHaveLength(1);
  });
});
