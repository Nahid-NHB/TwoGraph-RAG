import { parseChunkId, type RankedHit } from '@twograph/core';
import type { FtsIndex } from '@twograph/store';
import type { Retriever, RetrieveOptions } from '../retriever.js';

/**
 * Wraps the SQLite FTS5 BM25 index (issue #30) behind the Retriever contract.
 * Exact identifiers win here — complements the vector retriever's intent matching.
 */
export class Bm25Retriever implements Retriever {
  readonly id = 'bm25' as const;

  constructor(
    private readonly fts: FtsIndex,
    private readonly repo: string,
  ) {}

  retrieve(query: string, options: RetrieveOptions = {}): Promise<RankedHit[]> {
    const hits = this.fts.search(this.repo, query, options.k ?? 20, {
      ...(options.filters?.kinds ? { kinds: options.filters.kinds } : {}),
      ...(options.filters?.pathPrefix ? { pathPrefix: options.filters.pathPrefix } : {}),
    });
    return Promise.resolve(
      hits.map((h) => ({
        symbolId: parseChunkId(h.chunkId).symbolId,
        score: h.score,
        source: this.id,
        provenance: {},
      })),
    );
  }
}
