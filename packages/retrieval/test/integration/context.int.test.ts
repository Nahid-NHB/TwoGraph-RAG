import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient, GraphQueries } from '@twograph/graph';
import { Indexer } from '@twograph/indexer';
import { openDatabase, MetadataStore, FtsIndex } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { assembleContext } from '@twograph/retrieval';

const REPO = 'contexttest';
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
  embedderId: 'mock-context',
  dimensions: embedder.dimensions,
});

let root: string;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-context-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  const indexer = new Indexer({
    repo: { id: REPO, rootPath: root, name: 'context-fixture' },
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

function readSpan(path: string, startLine: number, endLine: number): string {
  const lines = readFileSync(join(root, path), 'utf8').split('\n');
  return lines.slice(startLine - 1, endLine).join('\n');
}

describe('assembleContext over an indexed repo', () => {
  it('assembles signature, code, callers, callees, and related files for a real symbol', async () => {
    const result = await assembleContext({ store, graph: queries, readSpan }, REPO, [
      `${REPO}:auth/jwt.ts#verifyToken`,
    ]);

    expect(result.blocks).toHaveLength(1);
    const block = result.blocks[0]!;
    expect(block.citationId).toBe('S1');
    expect(block.text).toContain('export function verifyToken');
    expect(block.text).toContain('Callers:');
    expect(block.text).toContain('isAuthorized');
    expect(block.text).toContain('Callees:');
    expect(block.text).toMatch(/decodeToken|validateJWT/);
  });

  it('stays within budget across many real symbols', async () => {
    const symbolIds = [
      `${REPO}:auth/jwt.ts#verifyToken`,
      `${REPO}:auth/jwt.ts#validateJWT`,
      `${REPO}:auth/jwt.ts#decodeToken`,
      `${REPO}:auth/jwt.ts#signToken`,
      `${REPO}:api/handlers.ts#isAuthorized`,
      `${REPO}:api/handlers.ts#loginHandler`,
    ];
    const result = await assembleContext({ store, graph: queries, readSpan }, REPO, symbolIds, {
      tokenBudget: 500,
    });
    expect(result.totalTokens).toBeLessThanOrEqual(500);
  });
});
