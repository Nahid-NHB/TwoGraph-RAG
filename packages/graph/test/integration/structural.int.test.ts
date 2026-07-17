import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedFile } from '@twograph/core';
import { createModuleResolver, ParserEngine, resolveReferences } from '@twograph/parser';
import { bootstrapSchema, GraphClient, GraphWriter } from '@twograph/graph';

const REPO = 'stest';
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
  for (const file of files) await writer.writeStructuralEdges(file, resolver);
}, 120_000);

afterAll(async () => {
  await wipe();
  await client.close();
});

const one = async (q: string, params: Record<string, unknown> = {}) =>
  (await client.run(q, { repo: REPO, ...params }))[0];

describe('structural edges', () => {
  it('IMPORTS: File→File for resolved relative imports', async () => {
    const row = await one(
      `MATCH (:File {id: $a})-[r:IMPORTS]->(b:File {id: $b}) RETURN r.kind AS kind`,
      { a: `${REPO}:api/users.ts`, b: `${REPO}:api/client.ts` },
    );
    expect(row?.get('kind')).toBe('static');
  });

  it('IMPORTS: File→Dependency for packages (axios), scoped names intact', async () => {
    const row = await one(
      `MATCH (:File {id: $a})-[:IMPORTS]->(d:Dependency) RETURN d.name AS name`,
      { a: `${REPO}:api/client.ts` },
    );
    expect(row?.get('name')).toBe('axios');
  });

  it('DEFINES and DECLARES ownership', async () => {
    const fn = await one(
      `MATCH (:File {id: $f})-[:DEFINES]->(s:Function {name: 'verifyToken'}) RETURN s.id AS id`,
      { f: `${REPO}:auth/jwt.ts` },
    );
    expect(fn?.get('id')).toBe(`${REPO}:auth/jwt.ts#verifyToken`);
    const v = await one(
      `MATCH (:File {id: $f})-[:DECLARES]->(s:Variable {name: 'API_BASE'}) RETURN s.id AS id`,
      { f: `${REPO}:api/client.ts` },
    );
    expect(v?.get('id')).toBeDefined();
  });

  it('Class DEFINES its methods', async () => {
    const row = await one(
      `MATCH (c:Class {name: 'AuthService', repoId: $repo})-[:DEFINES]->(m:Method)
       RETURN collect(m.name) AS methods`,
    );
    expect(row?.get('methods')).toEqual(expect.arrayContaining(['login', 'logout', 'currentUser']));
  });

  it('EXPORTS: local symbols and barrel re-exports', async () => {
    const named = await one(
      `MATCH (:File {id: $f})-[r:EXPORTS]->(s:Function {name: 'formatName'}) RETURN r.exportKind AS k`,
      { f: `${REPO}:utils/format.ts` },
    );
    expect(named?.get('k')).toBe('named');
    const star = await one(
      `MATCH (:File {id: $f})-[r:EXPORTS {exportKind: 'star'}]->(b:File) RETURN b.id AS id`,
      { f: `${REPO}:utils/index.ts` },
    );
    expect(star?.get('id')).toBe(`${REPO}:utils/format.ts`);
  });

  it('EXTENDS and IMPLEMENTS edges from resolved heritage', async () => {
    const ext = await one(
      `MATCH (a:Class {name: 'AuthService', repoId: $repo})-[:EXTENDS]->(b:Class) RETURN b.name AS n`,
    );
    expect(ext?.get('n')).toBe('BaseService');
    const impl = await one(
      `MATCH (a:Class {name: 'AuthService', repoId: $repo})-[:IMPLEMENTS]->(b:Interface) RETURN b.name AS n`,
    );
    expect(impl?.get('n')).toBe('IAuthService');
  });

  it('answers "which files depend on axios" (docs/05 canonical query)', async () => {
    const rows = await client.run(
      `MATCH (f:File {repoId: $repo})-[:IMPORTS]->(:Dependency {name: 'axios'}) RETURN f.path AS p`,
      { repo: REPO },
    );
    expect(rows.map((r) => r.get('p') as string)).toEqual(['api/client.ts']);
  });
});
