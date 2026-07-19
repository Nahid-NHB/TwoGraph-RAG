import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient, GraphQueries } from '@twograph/graph';
import { Indexer } from '@twograph/indexer';
import { MockLlmProvider } from '@twograph/llm';
import { Bm25Retriever, MockReranker, VectorRetriever } from '@twograph/retrieval';
import { openDatabase, MetadataStore, FtsIndex } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { runRagPipeline, type RagPipelineDeps } from '@twograph/rag';

const REPO = 'ragtest';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const QDRANT = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

const graphClient = new GraphClient({ uri: MEMGRAPH });
const graphQueries = new GraphQueries(graphClient);
const db = openDatabase(':memory:');
const store = new MetadataStore(db);
const fts = new FtsIndex(db);
const embedder = new MockEmbedder();
const vectors = new QdrantVectorStore({
  url: QDRANT,
  embedderId: 'mock-rag',
  dimensions: embedder.dimensions,
});

let root: string;
let deps: RagPipelineDeps;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-rag-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  const indexer = new Indexer({
    repo: { id: REPO, rootPath: root, name: 'rag-fixture' },
    graphClient,
    store,
    fts,
    vectors,
    embedder,
  });
  await indexer.run();

  deps = {
    bm25: new Bm25Retriever(fts, REPO),
    vector: new VectorRetriever({ store, vectors, embedder }, REPO),
    graphQueries,
    reranker: new MockReranker(),
    store,
    llm: new MockLlmProvider([]), // overridden per-test
    readSpan: (path, startLine, endLine) =>
      readFileSync(join(root, path), 'utf8')
        .split('\n')
        .slice(startLine - 1, endLine)
        .join('\n'),
  };
}, 60_000);

afterAll(async () => {
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  await vectors.deleteByRepo(REPO);
  await graphClient.close();
  rmSync(root, { recursive: true, force: true });
});

describe('runRagPipeline over an indexed repo', () => {
  it('answers an authentication question, citing the auth fixtures', async () => {
    // Stands in for "how does authentication work?" — phrased so MockEmbedder's
    // hashed bag-of-tokens (not true semantic similarity) reliably surfaces the
    // auth fixtures; true intent matching is covered separately by the
    // real-embedder-gated tests in @twograph/vector and @twograph/indexer.
    const llm = new MockLlmProvider([
      'Authentication verifies the bearer token [S1] using JWT validation [S2].',
    ]);

    const result = await runRagPipeline({ ...deps, llm }, 'login authenticate verify token', {
      repo: REPO,
    });

    expect(result.groundedContext).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations.some((c) => c.file.startsWith('auth/'))).toBe(true);
    expect(result.content).toContain('[S1]');
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  }, 60_000);

  it('logs and returns stage timings for every pipeline stage', async () => {
    const llm = new MockLlmProvider(['Answer [S1].']);
    const result = await runRagPipeline({ ...deps, llm }, 'login authenticate verify token', {
      repo: REPO,
    });
    for (const stage of [
      'multiquery',
      'retrieve',
      'expand',
      'fuse',
      'rerank',
      'assemble',
      'generate',
    ]) {
      expect(result.stageTimings[stage]).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it('says "not enough context" and skips the LLM call when nothing is indexed', async () => {
    // Retrievers are repo-bound at construction, so simulating "no context"
    // means pointing them at a repo id that was genuinely never indexed —
    // not reusing `deps`, which is bound to the fixture repo.
    const emptyRepo = 'repo-that-was-never-indexed';
    const llm = new MockLlmProvider(['should never be used']);

    const result = await runRagPipeline(
      {
        ...deps,
        bm25: new Bm25Retriever(fts, emptyRepo),
        vector: new VectorRetriever({ store, vectors, embedder }, emptyRepo),
        llm,
      },
      'anything at all',
      { repo: emptyRepo },
    );

    expect(result.groundedContext).toBe(false);
    expect(result.content).toBe('Not enough context to answer this question.');
    expect(result.citations).toEqual([]);
    // Multi-query generation still runs (it doesn't know yet whether context
    // will be found), but the final generation call must be skipped.
    expect(llm.requests).toHaveLength(1);
    expect(result.stageTimings['generate']).toBeUndefined();
  }, 60_000);

  it('rendered citations resolve to real file spans on disk', async () => {
    const llm = new MockLlmProvider(['Answer [S1].']);
    const result = await runRagPipeline({ ...deps, llm }, 'login authenticate verify token', {
      repo: REPO,
    });
    const [citation] = result.citations;
    expect(citation).toBeDefined();
    const lines = readFileSync(join(root, citation!.file), 'utf8').split('\n');
    const span = lines.slice(citation!.startLine - 1, citation!.endLine).join('\n');
    expect(span.length).toBeGreaterThan(0);
  }, 60_000);
});
