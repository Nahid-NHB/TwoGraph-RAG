import type { RankedHit } from '@twograph/core';
import { semanticSearch, type SemanticSearchDeps } from '@twograph/indexer';
import type { Retriever, RetrieveOptions } from '../retriever.js';

/**
 * Wraps semanticSearch (issue #35) behind the Retriever contract. Intent
 * matching wins here — "authentication" finds verifyToken without the literal word.
 */
export class VectorRetriever implements Retriever {
  readonly id = 'vector' as const;

  constructor(
    private readonly deps: SemanticSearchDeps,
    private readonly repo: string,
  ) {}

  async retrieve(query: string, options: RetrieveOptions = {}): Promise<RankedHit[]> {
    const hits = await semanticSearch(this.deps, this.repo, query, options.k ?? 20, {
      ...(options.filters?.kinds ? { kinds: options.filters.kinds } : {}),
      ...(options.filters?.pathPrefix ? { pathPrefix: options.filters.pathPrefix } : {}),
      ...(options.filters?.language ? { language: options.filters.language } : {}),
    });
    return hits.map((h) => ({
      symbolId: h.symbolId,
      score: h.score,
      source: this.id,
      provenance: {},
    }));
  }
}
