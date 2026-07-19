import { describe, expect, it } from 'vitest';
import { openDatabase, MetadataStore } from '@twograph/store';
import {
  MockEmbedder,
  type VectorHit,
  type VectorSearchFilters,
  type VectorStore,
} from '@twograph/vector';
import { semanticSearch } from '@twograph/indexer';

interface SearchCall {
  repo: string;
  vector: Float32Array;
  k: number;
  filters: VectorSearchFilters;
}

class FakeVectorStore implements VectorStore {
  readonly calls: SearchCall[] = [];

  constructor(private readonly hits: VectorHit[]) {}

  ensureCollection(): Promise<void> {
    return Promise.resolve();
  }

  upsert(): Promise<void> {
    return Promise.resolve();
  }

  search(
    repo: string,
    vector: Float32Array,
    k = 20,
    filters: VectorSearchFilters = {},
  ): Promise<VectorHit[]> {
    this.calls.push({ repo, vector, k, filters });
    return Promise.resolve(this.hits.slice(0, k));
  }

  deleteBySymbolIds(): Promise<void> {
    return Promise.resolve();
  }

  deleteByRepo(): Promise<void> {
    return Promise.resolve();
  }
}

function seedSymbolAndChunk(db: ReturnType<typeof openDatabase>): void {
  db.exec(`INSERT INTO repositories (id, root_path, name) VALUES ('r', '/tmp/r', 'r')`);
  db.exec(
    `INSERT INTO files (id, repo_id, rel_path, language, content_hash, size_bytes)
     VALUES ('r:auth/jwt.ts', 'r', 'auth/jwt.ts', 'ts', 'filehash', 500)`,
  );
  db.exec(
    `INSERT INTO symbols (id, file_id, repo_id, kind, name, qualified, signature, doc,
                           start_line, end_line, exported, content_hash)
     VALUES ('r:auth/jwt.ts#verifyToken', 'r:auth/jwt.ts', 'r', 'function', 'verifyToken',
             'verifyToken', 'function verifyToken(token: string): TokenPayload',
             'Verifies a JWT-shaped token and returns its payload.', 10, 20, 1, 'symhash')`,
  );
  db.exec(
    `INSERT INTO chunks (id, symbol_id, repo_id, content, content_hash, embedded_at)
     VALUES ('r:auth/jwt.ts#verifyToken', 'r:auth/jwt.ts#verifyToken', 'r',
             '// auth/jwt.ts · function verifyToken\n// signature\nfunction verifyToken(token) {\n  return decodeToken(token);\n}',
             'chunkhash', datetime('now'))`,
  );
}

describe('semanticSearch', () => {
  it('hydrates vector hits with signature, doc, and snippet from metadata', async () => {
    const db = openDatabase(':memory:');
    seedSymbolAndChunk(db);
    const store = new MetadataStore(db);
    const vectors = new FakeVectorStore([
      {
        chunkId: 'r:auth/jwt.ts#verifyToken',
        symbolId: 'r:auth/jwt.ts#verifyToken',
        score: 0.93,
        name: 'verifyToken',
        path: 'auth/jwt.ts',
        kind: 'function',
      },
    ]);
    const embedder = new MockEmbedder();

    const results = await semanticSearch({ store, vectors, embedder }, 'r', 'verify token', 5);

    expect(results).toEqual([
      {
        symbolId: 'r:auth/jwt.ts#verifyToken',
        chunkId: 'r:auth/jwt.ts#verifyToken',
        score: 0.93,
        name: 'verifyToken',
        kind: 'function',
        path: 'auth/jwt.ts',
        signature: 'function verifyToken(token: string): TokenPayload',
        doc: 'Verifies a JWT-shaped token and returns its payload.',
        snippet: 'function verifyToken(token) {\n  return decodeToken(token);\n}',
      },
    ]);
    expect(vectors.calls).toHaveLength(1);
    const [call] = vectors.calls;
    expect(call?.vector).toBeInstanceOf(Float32Array);
    expect(call?.repo).toBe('r');
    expect(call?.k).toBe(5);
    expect(call?.filters).toEqual({});
  });

  it('passes filters through to the vector store', async () => {
    const db = openDatabase(':memory:');
    const store = new MetadataStore(db);
    const vectors = new FakeVectorStore([]);
    const embedder = new MockEmbedder();

    await semanticSearch({ store, vectors, embedder }, 'r', 'query', 3, { kinds: ['function'] });

    expect(vectors.calls).toHaveLength(1);
    const [call] = vectors.calls;
    expect(call?.k).toBe(3);
    expect(call?.filters).toEqual({ kinds: ['function'] });
  });

  it('tolerates hits whose symbol or chunk is missing from the metadata store', async () => {
    const db = openDatabase(':memory:');
    const store = new MetadataStore(db);
    const vectors = new FakeVectorStore([
      {
        chunkId: 'gone',
        symbolId: 'gone',
        score: 0.5,
        name: 'ghost',
        path: 'ghost.ts',
        kind: 'function',
      },
    ]);
    const embedder = new MockEmbedder();

    const results = await semanticSearch({ store, vectors, embedder }, 'r', 'query');

    expect(results).toEqual([
      {
        symbolId: 'gone',
        chunkId: 'gone',
        score: 0.5,
        name: 'ghost',
        kind: 'function',
        path: 'ghost.ts',
        signature: null,
        doc: null,
        snippet: '',
      },
    ]);
  });

  it('returns an empty array when nothing matches', async () => {
    const db = openDatabase(':memory:');
    const store = new MetadataStore(db);
    const vectors = new FakeVectorStore([]);
    const embedder = new MockEmbedder();

    const results = await semanticSearch({ store, vectors, embedder }, 'r', 'nothing');

    expect(results).toEqual([]);
  });
});
