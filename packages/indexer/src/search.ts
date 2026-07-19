import type { MetadataStore } from '@twograph/store';
import type { Embedder, VectorSearchFilters, VectorStore } from '@twograph/vector';

export interface SemanticSearchDeps {
  store: MetadataStore;
  vectors: VectorStore;
  embedder: Embedder;
}

export interface SemanticHit {
  symbolId: string;
  chunkId: string;
  score: number;
  name: string;
  kind: string;
  path: string;
  signature: string | null;
  doc: string | null;
  snippet: string;
}

/** First non-header body lines of a chunk — the header carries path/kind/signature/doc already. */
function snippetOf(content: string, maxLines = 4): string {
  const bodyLines = content.split('\n').filter((line) => !line.startsWith('// '));
  return bodyLines.slice(0, maxLines).join('\n').trim();
}

/**
 * High-level semantic search (issue #35): embed the query, search Qdrant,
 * then hydrate hits with signature/doc/snippet from SQLite metadata.
 */
export async function semanticSearch(
  deps: SemanticSearchDeps,
  repo: string,
  query: string,
  k = 10,
  filters: VectorSearchFilters = {},
): Promise<SemanticHit[]> {
  const [vector] = await deps.embedder.embed([query]);
  if (!vector) return [];

  const hits = await deps.vectors.search(repo, vector, k, filters);
  if (hits.length === 0) return [];

  const symbolsById = new Map(
    deps.store.symbolsByIds(hits.map((h) => h.symbolId)).map((s) => [s.id, s]),
  );
  const chunksById = new Map(
    deps.store.chunksByIds(hits.map((h) => h.chunkId)).map((c) => [c.id, c]),
  );

  return hits.map((h) => {
    const symbol = symbolsById.get(h.symbolId);
    const chunk = chunksById.get(h.chunkId);
    return {
      symbolId: h.symbolId,
      chunkId: h.chunkId,
      score: h.score,
      name: h.name,
      kind: h.kind,
      path: h.path,
      signature: symbol?.signature ?? null,
      doc: symbol?.doc ?? null,
      snippet: chunk ? snippetOf(chunk.content) : '',
    };
  });
}
