import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient, GraphQueries } from '@twograph/graph';
import { Indexer } from '@twograph/indexer';
import { MockLlmProvider } from '@twograph/llm';
import { askInSession, loadHistory, type AskInSessionDeps } from '@twograph/rag';
import { Bm25Retriever, MockReranker, VectorRetriever } from '@twograph/retrieval';
import { openDatabase, MetadataStore, FtsIndex } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';

const REPO = 'chattest';
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
  embedderId: 'mock-chat',
  dimensions: embedder.dimensions,
});

let root: string;

function readSpan(path: string, startLine: number, endLine: number): string {
  return readFileSync(join(root, path), 'utf8')
    .split('\n')
    .slice(startLine - 1, endLine)
    .join('\n');
}

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-chat-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  const indexer = new Indexer({
    repo: { id: REPO, rootPath: root, name: 'chat-fixture' },
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

function makeDeps(llm: MockLlmProvider): AskInSessionDeps {
  return {
    store,
    pipeline: {
      bm25: new Bm25Retriever(fts, REPO),
      vector: new VectorRetriever({ store, vectors, embedder }, REPO),
      graphQueries,
      reranker: new MockReranker(),
      store,
      llm,
      readSpan,
    },
  };
}

describe('askInSession', () => {
  it('persists a conversation and reloads it verbatim', async () => {
    const llm = new MockLlmProvider([
      JSON.stringify({ queries: ['who calls verifyToken', 'callers of verifyToken'] }),
      'verifyToken is called by isAuthorized [S1].',
    ]);
    const deps = makeDeps(llm);
    const session = store.createChatSession(REPO);

    const result = await askInSession(deps, session.id, 'who calls verifyToken', { repo: REPO });

    expect(result.groundedContext).toBe(true);
    expect(result.sessionId).toBe(session.id);

    const persisted = store.listChatMessages(session.id);
    expect(persisted).toHaveLength(2);
    expect(persisted[0]).toMatchObject({ role: 'user', content: 'who calls verifyToken' });
    expect(persisted[1]).toMatchObject({ role: 'assistant', content: result.content });
    expect(JSON.parse(persisted[1]?.citations_json ?? '[]')).toEqual(result.citations);

    const reloaded = loadHistory(store, session.id);
    expect(reloaded).toEqual([
      { role: 'user', content: 'who calls verifyToken', citations: [] },
      { role: 'assistant', content: result.content, citations: result.citations },
    ]);
  }, 60_000);

  it('resolves a pronoun follow-up via history to ask about the right subject', async () => {
    // Turn 1: establish "verifyToken" as the conversation's subject.
    const turn1Llm = new MockLlmProvider([
      JSON.stringify({ queries: ['who calls verifyToken', 'callers of verifyToken'] }),
      'verifyToken is called by isAuthorized [S1].',
    ]);
    const session = store.createChatSession(REPO);
    await askInSession(makeDeps(turn1Llm), session.id, 'who calls verifyToken', { repo: REPO });

    // Turn 2: "it" must resolve to verifyToken (not isAuthorized, the last
    // noun mentioned) via history — so retrieval targets what verifyToken
    // itself calls (decodeToken/validateJWT in auth/jwt.ts), not isAuthorized.
    const turn2Llm = new MockLlmProvider([
      'what does verifyToken call?',
      JSON.stringify({
        queries: ['verifyToken callees', 'decodeToken validateJWT', 'what verifyToken calls'],
      }),
      'verifyToken calls decodeToken and validateJWT [S1].',
    ]);
    const result = await askInSession(makeDeps(turn2Llm), session.id, 'what does it call?', {
      repo: REPO,
    });

    expect(turn2Llm.requests[0]?.messages.some((m) => m.content.includes('verifyToken'))).toBe(
      true,
    );
    expect(result.standaloneQuestion).toBe('what does verifyToken call?');
    expect(result.groundedContext).toBe(true);
    expect(result.citations.some((c) => c.file === 'auth/jwt.ts')).toBe(true);

    const allMessages = store.listChatMessages(session.id);
    expect(allMessages).toHaveLength(4);
    expect(allMessages[2]).toMatchObject({ role: 'user', content: 'what does it call?' });
  }, 60_000);
});
