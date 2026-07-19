import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient } from '@twograph/graph';
import { openDatabase, MetadataStore, FtsIndex } from '@twograph/store';
import { createEmbedder, MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { Indexer, semanticSearch } from '@twograph/indexer';

const REPO = 'semsearch';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const QDRANT = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

const graphClient = new GraphClient({ uri: MEMGRAPH });
const db = openDatabase(':memory:');
const store = new MetadataStore(db);
const fts = new FtsIndex(db);
let root: string;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-semsearch-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
}, 60_000);

afterAll(async () => {
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  await graphClient.close();
  rmSync(root, { recursive: true, force: true });
});

describe('semanticSearch over an indexed repo', () => {
  it('honors filters and hydrates signature/doc/snippet (mock embedder)', async () => {
    const embedder = new MockEmbedder();
    const vectors = new QdrantVectorStore({
      url: QDRANT,
      embedderId: 'mock-semsearch',
      dimensions: embedder.dimensions,
    });
    const indexer = new Indexer({
      repo: { id: REPO, rootPath: root, name: 'sem-search-fixture' },
      graphClient,
      store,
      fts,
      vectors,
      embedder,
    });
    await indexer.run();

    try {
      const hits = await semanticSearch(
        { store, vectors, embedder },
        REPO,
        'verify token signature',
        5,
      );
      expect(hits.length).toBeGreaterThan(0);
      const jwtHit = hits.find((h) => h.path === 'auth/jwt.ts');
      expect(jwtHit?.signature).toMatch(/verifyToken|validateJWT/);
      expect(jwtHit?.snippet.length).toBeGreaterThan(0);

      const filtered = await semanticSearch(
        { store, vectors, embedder },
        REPO,
        'verify token signature',
        5,
        { kinds: ['interface'] },
      );
      expect(filtered.every((h) => h.kind === 'interface')).toBe(true);
    } finally {
      await vectors.deleteByRepo(REPO);
    }
  }, 60_000);

  // FR-4.3 intent search: "authentication" should surface verifyToken/login/validateJWT
  // without the literal keyword. Requires a real embedding model — opt-in only.
  describe.skipIf(!process.env['TWOGRAPH_TEST_REAL_EMBEDDER'])(
    'intent search (real embedder)',
    () => {
      it('"authentication" surfaces verifyToken/login/validateJWT in the top 5', async () => {
        const embedder = createEmbedder('unixcoder-onnx');
        const vectors = new QdrantVectorStore({
          url: QDRANT,
          embedderId: embedder.id,
          dimensions: embedder.dimensions,
        });
        const indexer = new Indexer({
          repo: { id: REPO, rootPath: root, name: 'sem-search-fixture' },
          graphClient,
          store,
          fts,
          vectors,
          embedder,
        });
        await indexer.run({ rebuild: true });

        try {
          const hits = await semanticSearch(
            { store, vectors, embedder },
            REPO,
            'authentication',
            5,
          );
          const names = hits.map((h) => h.name);
          expect(names.some((n) => ['verifyToken', 'login', 'validateJWT'].includes(n))).toBe(true);
        } finally {
          await vectors.deleteByRepo(REPO);
        }
      }, 300_000);
    },
  );
});
