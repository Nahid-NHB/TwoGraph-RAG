import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient } from '@twograph/graph';
import { FtsIndex, MetadataStore, openDatabase } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { Indexer } from '@twograph/indexer';

const REPO = 'embedcachetest';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const QDRANT = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

const graphClient = new GraphClient({ uri: MEMGRAPH });
// A real embedder (not a spy) so "never re-embedded" is proven by the
// pipeline's own embedded-chunk count, not by intercepting a mock.
const embedder = new MockEmbedder();
const vectors = new QdrantVectorStore({
  url: QDRANT,
  embedderId: 'mock-embedcache',
  dimensions: embedder.dimensions,
});

let root: string;
let dbPath: string;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-embedcache-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  dbPath = join(root, '.twograph', 'store.db');
}, 60_000);

afterAll(async () => {
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  await vectors.deleteByRepo(REPO);
  await graphClient.close();
  rmSync(root, { recursive: true, force: true });
});

/** A brand-new MetadataStore + FtsIndex + Indexer against the SAME on-disk
 * sqlite file — stands in for a process restart, since nothing here is
 * carried over in memory. */
function reopenIndexer(): Indexer {
  const db = openDatabase(dbPath);
  const store = new MetadataStore(db);
  const fts = new FtsIndex(db);
  return new Indexer({
    repo: { id: REPO, rootPath: root, name: 'embedcache-copy' },
    graphClient,
    store,
    fts,
    vectors,
    embedder,
  });
}

describe('content-hash embedding cache survives a restart (issue #71)', () => {
  it('embeds every chunk on the first run', async () => {
    const result = await reopenIndexer().run();
    expect(result.errors).toEqual([]);
    expect(result.embedded).toBeGreaterThan(50);
  }, 120_000);

  it('a fresh store/indexer instance against the same db re-runs with zero re-embeds', async () => {
    // New MetadataStore, new FtsIndex, new Indexer — only the sqlite file and
    // the Qdrant collection persist, exactly as they would across a real
    // process restart.
    const result = await reopenIndexer().run();
    expect(result).toMatchObject({ added: 0, changed: 0, removed: 0, embedded: 0 });
  }, 60_000);

  it('after a restart, only a genuinely changed file gets re-embedded', async () => {
    writeFileSync(
      join(root, 'utils/format.ts'),
      [
        'export function formatDate(iso: string): string {',
        '  return new Date(iso).toLocaleDateString();',
        '}',
        'export const RESTART_MARKER = true;',
      ].join('\n'),
    );
    const result = await reopenIndexer().run();
    expect(result.changed).toBe(1);
    expect(result.embedded).toBeGreaterThan(0);

    // And a third "restart" with no further changes is, again, a no-op.
    const again = await reopenIndexer().run();
    expect(again).toMatchObject({ added: 0, changed: 0, removed: 0, embedded: 0 });
  }, 60_000);
});
