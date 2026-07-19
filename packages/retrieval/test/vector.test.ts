import { describe, expect, it } from 'vitest';
import { openDatabase, MetadataStore } from '@twograph/store';
import {
  MockEmbedder,
  type VectorHit,
  type VectorSearchFilters,
  type VectorStore,
} from '@twograph/vector';
import { VectorRetriever } from '@twograph/retrieval';

class FakeVectorStore implements VectorStore {
  lastCall: { k: number; filters: VectorSearchFilters } | undefined;

  constructor(private readonly hits: VectorHit[]) {}

  ensureCollection(): Promise<void> {
    return Promise.resolve();
  }

  upsert(): Promise<void> {
    return Promise.resolve();
  }

  search(
    _repo: string,
    _vector: Float32Array,
    k = 20,
    filters: VectorSearchFilters = {},
  ): Promise<VectorHit[]> {
    this.lastCall = { k, filters };
    return Promise.resolve(this.hits.slice(0, k));
  }

  deleteBySymbolIds(): Promise<void> {
    return Promise.resolve();
  }

  deleteByRepo(): Promise<void> {
    return Promise.resolve();
  }
}

describe('VectorRetriever', () => {
  it('returns normalized RankedHits tagged with source "vector"', async () => {
    const db = openDatabase(':memory:');
    const store = new MetadataStore(db);
    const vectors = new FakeVectorStore([
      {
        chunkId: 'r:auth/jwt.ts#verifyToken',
        symbolId: 'r:auth/jwt.ts#verifyToken',
        score: 0.87,
        name: 'verifyToken',
        path: 'auth/jwt.ts',
        kind: 'function',
      },
    ]);
    const retriever = new VectorRetriever({ store, vectors, embedder: new MockEmbedder() }, 'r');

    const hits = await retriever.retrieve('authentication');

    expect(hits).toEqual([
      { symbolId: 'r:auth/jwt.ts#verifyToken', score: 0.87, source: 'vector', provenance: {} },
    ]);
  });

  it('passes k and filters through to the vector store', async () => {
    const db = openDatabase(':memory:');
    const store = new MetadataStore(db);
    const vectors = new FakeVectorStore([]);
    const retriever = new VectorRetriever({ store, vectors, embedder: new MockEmbedder() }, 'r');

    await retriever.retrieve('query', {
      k: 4,
      filters: { kinds: ['function'], pathPrefix: 'src' },
    });

    expect(vectors.lastCall).toEqual({
      k: 4,
      filters: { kinds: ['function'], pathPrefix: 'src' },
    });
  });
});
