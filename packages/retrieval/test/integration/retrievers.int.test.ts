import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient, GraphQueries } from '@twograph/graph';
import { Indexer } from '@twograph/indexer';
import { openDatabase, MetadataStore, FtsIndex } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { Bm25Retriever, GraphRetriever, VectorRetriever } from '@twograph/retrieval';

const REPO = 'retrievaltest';
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
  embedderId: 'mock-retrieval',
  dimensions: embedder.dimensions,
});

let root: string;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-retrieval-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  const indexer = new Indexer({
    repo: { id: REPO, rootPath: root, name: 'retrieval-fixture' },
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

describe('retrievers over an indexed repo', () => {
  it('Bm25Retriever returns source-tagged hits for a literal query', async () => {
    const retriever = new Bm25Retriever(fts, REPO);
    const hits = await retriever.retrieve('verify token signature');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === 'bm25')).toBe(true);
    expect(hits.some((h) => h.symbolId.includes('auth/jwt.ts'))).toBe(true);
  });

  it('VectorRetriever returns source-tagged hits hydrated from the vector store', async () => {
    const retriever = new VectorRetriever({ store, vectors, embedder }, REPO);
    const hits = await retriever.retrieve('verify token signature');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === 'vector')).toBe(true);
    expect(hits.some((h) => h.symbolId.includes('auth/jwt.ts'))).toBe(true);
  });

  it('GraphRetriever answers "who calls X" standalone', async () => {
    const retriever = new GraphRetriever(queries, REPO);
    const hits = await retriever.retrieve('who calls verifyToken');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === 'graph' && h.graphPath)).toBe(true);
    expect(hits.some((h) => h.symbolId.endsWith('#isAuthorized'))).toBe(true);
  });

  it('GraphRetriever answers component usage intents', async () => {
    const retriever = new GraphRetriever(queries, REPO);
    const hits = await retriever.retrieve('usage of Button');
    expect(hits.some((h) => h.symbolId.includes('#LoginForm'))).toBe(true);
  });

  it('GraphRetriever returns nothing for queries without a graph intent', async () => {
    const retriever = new GraphRetriever(queries, REPO);
    const hits = await retriever.retrieve('how do I validate a jwt token');
    expect(hits).toEqual([]);
  });
});
