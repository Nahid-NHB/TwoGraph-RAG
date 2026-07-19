import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient, GraphQueries } from '@twograph/graph';
import { Indexer } from '@twograph/indexer';
import { openDatabase, MetadataStore, FtsIndex } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { expandSeeds } from '@twograph/retrieval';
import type { RankedHit } from '@twograph/core';

const REPO = 'expansiontest';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const QDRANT = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

const graphClient = new GraphClient({ uri: MEMGRAPH });
const queries = new GraphQueries(graphClient);
const db = openDatabase(':memory:');
const store = new MetadataStore(db);
const fts = new FtsIndex(db);
const embedder = new MockEmbedder();
const vectors = new QdrantVectorStore({
  url: QDRANT,
  embedderId: 'mock-expansion',
  dimensions: embedder.dimensions,
});

let root: string;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-expansion-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  const indexer = new Indexer({
    repo: { id: REPO, rootPath: root, name: 'expansion-fixture' },
    graphClient,
    store,
    fts,
    vectors,
    embedder,
  });
  await indexer.run();
}, 60_000);

afterAll(async () => {
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  await vectors.deleteByRepo(REPO);
  await graphClient.close();
  rmSync(root, { recursive: true, force: true });
});

function seed(symbolId: string, score = 1): RankedHit {
  return { symbolId, score, source: 'bm25', provenance: {} };
}

describe('expandSeeds', () => {
  it('pulls the full call/hook chain for a flow-style seed', async () => {
    // UserList --USES_HOOK--> useUsers --CALLS--> fetchUsers --CALLS--> fetchJson
    const expanded = await expandSeeds(queries, REPO, [seed(`${REPO}:api/users.ts#fetchUsers`)], {
      hops: 2,
    });
    const ids = expanded.map((h) => h.symbolId);

    expect(ids).toContain(`${REPO}:api/client.ts#fetchJson`);
    expect(ids).toContain(`${REPO}:hooks/useUsers.ts#useUsers`);
    expect(ids).toContain(`${REPO}:components/UserList.tsx#UserList`);
    expect(expanded.every((h) => h.source === 'expansion' && h.graphPath)).toBe(true);
  });

  it('decays score by hop count, and the decay factor is configurable', async () => {
    const expanded = await expandSeeds(
      queries,
      REPO,
      [seed(`${REPO}:api/users.ts#fetchUsers`, 1)],
      { hops: 2, decay: 0.5 },
    );
    const oneHop = expanded.find((h) => h.symbolId === `${REPO}:api/client.ts#fetchJson`);
    const twoHop = expanded.find((h) => h.symbolId === `${REPO}:components/UserList.tsx#UserList`);

    expect(oneHop?.score).toBeCloseTo(0.5, 10);
    expect(twoHop?.score).toBeCloseTo(0.25, 10);
  });

  it('bounds expansion per seed to avoid hub-node explosion', async () => {
    const expanded = await expandSeeds(queries, REPO, [seed(`${REPO}:api/users.ts#fetchUsers`)], {
      hops: 2,
      maxPerSeed: 1,
    });
    expect(expanded).toHaveLength(1);
  });

  it('returns nothing for an empty seed list', async () => {
    expect(await expandSeeds(queries, REPO, [])).toEqual([]);
  });
});
