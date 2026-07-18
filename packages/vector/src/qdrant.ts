import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { createLogger, VectorStoreError } from '@twograph/core';

const log = createLogger('vector:qdrant');

export interface VectorPoint {
  chunkId: string;
  symbolId: string;
  repo: string;
  vector: Float32Array;
  payload: {
    kind: string;
    path: string;
    language: string;
    name: string;
    exported: boolean;
  };
}

export interface VectorSearchFilters {
  kinds?: string[];
  pathPrefix?: string;
  language?: string;
}

export interface VectorHit {
  chunkId: string;
  symbolId: string;
  score: number;
  name: string;
  path: string;
  kind: string;
}

/** Swappable ANN store contract (docs/09 §3). */
export interface VectorStore {
  ensureCollection(): Promise<void>;
  upsert(points: VectorPoint[]): Promise<void>;
  search(
    repo: string,
    vector: Float32Array,
    k?: number,
    filters?: VectorSearchFilters,
  ): Promise<VectorHit[]>;
  deleteBySymbolIds(repo: string, symbolIds: string[]): Promise<void>;
  deleteByRepo(repo: string): Promise<void>;
}

/** Deterministic UUID for a chunk id (Qdrant point ids must be uuid/int). */
export function pointIdFor(chunkId: string): string {
  const hex = createHash('sha1').update(chunkId).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** All ancestor directories of a path — enables exact subtree filters. */
export function ancestorDirs(path: string): string[] {
  const segments = path.split('/');
  const dirs: string[] = [];
  for (let i = 1; i < segments.length; i++) dirs.push(segments.slice(0, i).join('/'));
  return dirs;
}

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;
  readonly collection: string;
  private readonly dimensions: number;

  constructor(options: { url: string; embedderId: string; dimensions: number }) {
    this.client = new QdrantClient({ url: options.url });
    this.collection = `twograph_${options.embedderId.replaceAll('-', '_')}_${String(options.dimensions)}`;
    this.dimensions = options.dimensions;
  }

  async ensureCollection(): Promise<void> {
    try {
      const { collections } = await this.client.getCollections();
      if (collections.some((c) => c.name === this.collection)) return;
      await this.client.createCollection(this.collection, {
        vectors: { size: this.dimensions, distance: 'Cosine' },
      });
      for (const field of ['repo_id', 'kind', 'language', 'dirs', 'symbol_id'] as const) {
        await this.client.createPayloadIndex(this.collection, {
          field_name: field,
          field_schema: 'keyword',
          wait: true,
        });
      }
      log.info({ collection: this.collection }, 'created qdrant collection');
    } catch (err) {
      throw new VectorStoreError(`ensureCollection failed for ${this.collection}`, { cause: err });
    }
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    try {
      await this.client.upsert(this.collection, {
        wait: true,
        points: points.map((p) => ({
          id: pointIdFor(p.chunkId),
          vector: Array.from(p.vector),
          payload: {
            chunk_id: p.chunkId,
            symbol_id: p.symbolId,
            repo_id: p.repo,
            kind: p.payload.kind,
            path: p.payload.path,
            dirs: ancestorDirs(p.payload.path),
            language: p.payload.language,
            name: p.payload.name,
            exported: p.payload.exported,
          },
        })),
      });
    } catch (err) {
      throw new VectorStoreError('vector upsert failed', { cause: err });
    }
  }

  async search(
    repo: string,
    vector: Float32Array,
    k = 20,
    filters: VectorSearchFilters = {},
  ): Promise<VectorHit[]> {
    const must: Record<string, unknown>[] = [{ key: 'repo_id', match: { value: repo } }];
    if (filters.kinds && filters.kinds.length > 0) {
      must.push({ key: 'kind', match: { any: filters.kinds } });
    }
    if (filters.pathPrefix) {
      must.push({ key: 'dirs', match: { value: filters.pathPrefix.replace(/\/$/, '') } });
    }
    if (filters.language) {
      must.push({ key: 'language', match: { value: filters.language } });
    }
    try {
      const results = await this.client.search(this.collection, {
        vector: Array.from(vector),
        limit: k,
        filter: { must },
        with_payload: true,
      });
      return results.map((r) => {
        const payload = r.payload as Record<string, unknown>;
        return {
          chunkId: payload['chunk_id'] as string,
          symbolId: payload['symbol_id'] as string,
          score: r.score,
          name: payload['name'] as string,
          path: payload['path'] as string,
          kind: payload['kind'] as string,
        };
      });
    } catch (err) {
      throw new VectorStoreError('vector search failed', { cause: err });
    }
  }

  async deleteBySymbolIds(repo: string, symbolIds: string[]): Promise<void> {
    if (symbolIds.length === 0) return;
    try {
      await this.client.delete(this.collection, {
        wait: true,
        filter: {
          must: [
            { key: 'repo_id', match: { value: repo } },
            { key: 'symbol_id', match: { any: symbolIds } },
          ],
        },
      });
    } catch (err) {
      throw new VectorStoreError('vector delete failed', { cause: err });
    }
  }

  async deleteByRepo(repo: string): Promise<void> {
    try {
      await this.client.delete(this.collection, {
        wait: true,
        filter: { must: [{ key: 'repo_id', match: { value: repo } }] },
      });
    } catch (err) {
      throw new VectorStoreError('vector repo delete failed', { cause: err });
    }
  }
}
