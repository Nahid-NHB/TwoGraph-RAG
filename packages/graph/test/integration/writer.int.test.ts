import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParsedFile } from '@twograph/core';
import { ParserEngine } from '@twograph/parser';
import { bootstrapSchema, GraphClient, GraphWriter } from '@twograph/graph';

const REPO = 'wtest';
const URI = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const client = new GraphClient({ uri: URI });
const writer = new GraphWriter(client);
const engine = new ParserEngine();
const ROOT = join(import.meta.dirname, '../../../../examples/sample-repo/src');

async function parseAll(): Promise<ParsedFile[]> {
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
  return files;
}

const wipe = () => client.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });

beforeAll(async () => {
  if (!(await client.healthcheck())) throw new Error(`Memgraph not reachable at ${URI}`);
  await bootstrapSchema(client);
  await wipe();
});

afterAll(async () => {
  await wipe();
  await client.close();
});

describe('GraphWriter: nodes + CONTAINS hierarchy', () => {
  let files: ParsedFile[];

  it('writes the whole sample repo', async () => {
    files = await parseAll();
    await writer.ensureRepository({ id: REPO, name: 'sample', rootPath: ROOT });
    for (const file of files) await writer.writeParsedFile(file);

    const fileCount = await client.run('MATCH (f:File {repoId: $repo}) RETURN count(f) AS c', {
      repo: REPO,
    });
    expect(fileCount[0]?.get('c')).toBe(files.length);
  });

  it('builds the full CONTAINS chain down to a symbol', async () => {
    const rows = await client.run(
      `MATCH p = (r:Repository {id: $repo})-[:CONTAINS*]->(fn:Function {name: 'verifyToken'})
       RETURN [n IN nodes(p) | n.name] AS chain`,
      { repo: REPO },
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.get('chain')).toEqual(['sample', 'auth', 'jwt.ts', 'verifyToken']);
  });

  it('labels symbols correctly (components, hooks, contexts, routes)', async () => {
    const count = async (q: string) => (await client.run(q, { repo: REPO }))[0]?.get('c') as number;
    expect(await count('MATCH (n:Component {repoId: $repo}) RETURN count(n) AS c')).toBeGreaterThan(
      8,
    );
    expect(
      await count('MATCH (n:Hook {repoId: $repo}) RETURN count(n) AS c'),
    ).toBeGreaterThanOrEqual(4);
    expect(await count('MATCH (n:Context {repoId: $repo}) RETURN count(n) AS c')).toBe(1);
    expect(
      await count('MATCH (n:Route {repoId: $repo}) RETURN count(n) AS c'),
    ).toBeGreaterThanOrEqual(7);
  });

  it('is idempotent: rewriting changes no node counts', async () => {
    const total = async (): Promise<number> => {
      const rows = await client.run('MATCH (n {repoId: $repo}) RETURN count(n) AS c', {
        repo: REPO,
      });
      return rows[0]?.get('c') as number;
    };
    const before = await total();
    for (const file of files) await writer.writeParsedFile(file);
    expect(await total()).toBe(before);
  });
});
