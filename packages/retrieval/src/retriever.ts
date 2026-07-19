import type { RankedHit, RetrievalSource } from '@twograph/core';

export interface RetrieveFilters {
  kinds?: string[];
  pathPrefix?: string;
  language?: string;
}

export interface RetrieveOptions {
  k?: number;
  filters?: RetrieveFilters;
}

/**
 * Uniform retriever contract (docs/09 §4): any number of these can be
 * registered and fused by RRF without the fusion step knowing their internals.
 */
export interface Retriever {
  readonly id: RetrievalSource;
  retrieve(query: string, options?: RetrieveOptions): Promise<RankedHit[]>;
}
