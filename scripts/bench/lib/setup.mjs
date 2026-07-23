// Shared fixture: a real Memgraph + Qdrant backed index of examples/sample-repo,
// built with the deterministic Mock embedder so results are stable across runs
// and don't require model downloads or API keys.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphClient, GraphQueries } from '@twograph/graph';
import { Indexer } from '@twograph/indexer';
import { Bm25Retriever, GraphRetriever, MockReranker, VectorRetriever } from '@twograph/retrieval';
import { openDatabase, MetadataStore, FtsIndex } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';

const REPO = 'bench-sample-repo';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const QDRANT = process.env['QDRANT_URL'] ?? 'http://localhost:6333';
const SAMPLE_REPO_SRC = fileURLToPath(
  new URL('../../../examples/sample-repo/src', import.meta.url),
);

export async function setupBenchFixture() {
  const graphClient = new GraphClient({ uri: MEMGRAPH });
  if (!(await graphClient.healthcheck())) {
    throw new Error(`Memgraph unreachable at ${MEMGRAPH} — run "docker compose up -d" first`);
  }
  const graphQueries = new GraphQueries(graphClient);
  const db = openDatabase(':memory:');
  const store = new MetadataStore(db);
  const fts = new FtsIndex(db);
  const embedder = new MockEmbedder();
  const vectors = new QdrantVectorStore({
    url: QDRANT,
    embedderId: 'mock-bench',
    dimensions: embedder.dimensions,
  });

  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  const root = mkdtempSync(join(tmpdir(), 'twograph-bench-'));
  cpSync(SAMPLE_REPO_SRC, root, { recursive: true });

  const retrieval = {
    bm25: new Bm25Retriever(fts, REPO),
    vector: new VectorRetriever({ store, vectors, embedder }, REPO),
    graph: new GraphRetriever(graphQueries, REPO),
    reranker: new MockReranker(),
  };

  async function cleanup() {
    await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
    await vectors.deleteByRepo(REPO);
    await graphClient.close();
    rmSync(root, { recursive: true, force: true });
  }

  return {
    repo: REPO,
    root,
    graphClient,
    graphQueries,
    store,
    fts,
    vectors,
    embedder,
    retrieval,
    cleanup,
  };
}

/** Fresh Indexer bound to the fixture, with a stage-timing hook for benches. */
export function makeIndexer(fixture, onProgress) {
  return new Indexer(
    {
      repo: { id: fixture.repo, rootPath: fixture.root, name: 'bench-sample-repo' },
      graphClient: fixture.graphClient,
      store: fixture.store,
      fts: fixture.fts,
      vectors: fixture.vectors,
      embedder: fixture.embedder,
    },
    onProgress,
  );
}
