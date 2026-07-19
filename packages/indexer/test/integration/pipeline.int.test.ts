import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient, GraphQueries } from '@twograph/graph';
import { FtsIndex, MetadataStore, openDatabase } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { Indexer } from '@twograph/indexer';

const REPO = 'pipetest';
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
  embedderId: 'mock-pipe',
  dimensions: embedder.dimensions,
});

let root: string;
let indexer: Indexer;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  // Work on a disposable copy so edits never touch the fixture.
  root = mkdtempSync(join(tmpdir(), 'twograph-pipe-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  indexer = new Indexer({
    repo: { id: REPO, rootPath: root, name: 'sample-copy' },
    graphClient,
    store,
    fts,
    vectors,
    embedder,
  });
}, 60_000);

afterAll(async () => {
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  await vectors.deleteByRepo(REPO);
  await graphClient.close();
  rmSync(root, { recursive: true, force: true });
});

describe('Indexer end-to-end', () => {
  it('full first run populates graph, store, fts, and vectors', async () => {
    const result = await indexer.run();
    expect(result.errors).toEqual([]);
    expect(result.added).toBeGreaterThanOrEqual(20);
    expect(result.embedded).toBeGreaterThan(50);

    // Graph
    const callers = await queries.callers(REPO, `${REPO}:api/client.ts#fetchJson`, 1);
    expect(callers.map((c) => c.name)).toContain('fetchUser');
    // FTS
    expect(fts.search(REPO, 'verify token').some((h) => h.path === 'auth/jwt.ts')).toBe(true);
    // Vectors
    const [q] = await embedder.embed(['validate jwt token verify']);
    const hits = await vectors.search(REPO, q!, 5);
    expect(hits.some((h) => h.symbolId.includes('jwt.ts'))).toBe(true);
    // Store journal
    expect(store.getIndexRun(result.runId)?.error).toBeNull();
  }, 120_000);

  it('second run with no changes is a near-no-op', async () => {
    const result = await indexer.run();
    expect(result).toMatchObject({ added: 0, changed: 0, removed: 0, embedded: 0 });
    expect(result.durationMs).toBeLessThan(5000);
  }, 60_000);

  it('single-file change reindexes exactly that file', async () => {
    writeFileSync(
      join(root, 'utils/constants.ts'),
      [
        "export const APP_NAME = 'Renamed Directory';",
        'export const PAGE_SIZE = 50;',
        'export enum FeatureFlag { NewNav = "new-nav" }',
      ].join('\n'),
    );
    const result = await indexer.run();
    expect(result).toMatchObject({ added: 0, changed: 1, removed: 0 });
    expect(result.embedded).toBeGreaterThan(0);
    expect(result.embedded).toBeLessThanOrEqual(4);
  }, 60_000);

  it('removed files are purged from graph, fts, and store', async () => {
    rmSync(join(root, 'components/DeadBanner.tsx'));
    const result = await indexer.run();
    expect(result.removed).toBe(1);
    expect(store.fileHashes(REPO).has('components/DeadBanner.tsx')).toBe(false);
    expect(
      fts
        .search(REPO, 'DeadBanner unreachable')
        .some((h) => h.path === 'components/DeadBanner.tsx'),
    ).toBe(false);
    const rows = await graphClient.run(
      `MATCH (c:Component {name: 'DeadBanner', repoId: $repo}) RETURN count(c) AS c`,
      { repo: REPO },
    );
    expect(rows[0]?.get('c')).toBe(0);
  }, 60_000);

  it('a broken file is isolated and does not fail the run', async () => {
    writeFileSync(join(root, 'broken.ts'), 'export function {{{{');
    const result = await indexer.run();
    // Error-tolerant parse still succeeds; file indexes with partial symbols.
    expect(result.added).toBe(1);
  }, 60_000);
});
