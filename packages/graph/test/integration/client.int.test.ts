import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapSchema, GraphClient } from '@twograph/graph';

const URI = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const client = new GraphClient({ uri: URI });

beforeAll(async () => {
  if (!(await client.healthcheck())) {
    throw new Error(`Memgraph not reachable at ${URI} — run: docker compose up -d`);
  }
});

afterAll(async () => {
  await client.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: 'int-test' });
  await client.close();
});

describe('GraphClient against Memgraph', () => {
  it('runs parameterized queries', async () => {
    const records = await client.run('RETURN $x + 1 AS y', { x: 41 });
    expect(records[0]?.get('y')).toBe(42);
  });

  it('bootstraps the schema idempotently (twice)', async () => {
    await bootstrapSchema(client);
    await bootstrapSchema(client);
    const indexes = await client.run('SHOW INDEX INFO');
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('MERGE with the id constraint is idempotent', async () => {
    for (let i = 0; i < 2; i++) {
      await client.run('MERGE (f:Function {id: $id}) SET f.repoId = $repo, f.name = $name', {
        id: 'int-test:a.ts#fn',
        repo: 'int-test',
        name: 'fn',
      });
    }
    const rows = await client.run('MATCH (f:Function {id: $id}) RETURN count(f) AS c', {
      id: 'int-test:a.ts#fn',
    });
    expect(rows[0]?.get('c')).toBe(1);
  });

  it('transactions commit atomically', async () => {
    await client.withTx(async (tx) => {
      await tx.run('CREATE (a:Variable {id: $a, repoId: $repo})', {
        a: 'int-test:a.ts#v1',
        repo: 'int-test',
      });
      await tx.run('CREATE (b:Variable {id: $b, repoId: $repo})', {
        b: 'int-test:a.ts#v2',
        repo: 'int-test',
      });
    });
    const rows = await client.run('MATCH (v:Variable {repoId: $repo}) RETURN count(v) AS c', {
      repo: 'int-test',
    });
    expect(rows[0]?.get('c')).toBe(2);
  });
});
