import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { parseSymbolId, type RankedHit } from '@twograph/core';
import { semanticSearch } from '@twograph/indexer';
import { Bm25Retriever, fuseRankedLists, VectorRetriever } from '@twograph/retrieval';
import type { MetadataStore } from '@twograph/store';
import type { RegisteredRepo, RepoRegistry } from '../registry.js';

const filtersSchema = z.object({
  kinds: z.array(z.string()).optional(),
  pathPrefix: z.string().optional(),
  language: z.string().optional(),
});

const searchBodySchema = z.object({
  query: z.string().min(1),
  k: z.number().int().min(1).max(100).optional(),
  mode: z.enum(['hybrid', 'semantic', 'keyword']).optional(),
  filters: filtersSchema.optional(),
});

const hitSchema = z.object({
  symbolId: z.string(),
  score: z.number(),
  source: z.string(),
  name: z.string().nullable(),
  path: z.string().nullable(),
  kind: z.string().nullable(),
  snippet: z.string().nullable(),
});

/** First non-header body lines of a chunk, for search-result snippets. */
function snippetOf(content: string, maxLines = 4): string {
  return content
    .split('\n')
    .filter((line) => !line.startsWith('// '))
    .slice(0, maxLines)
    .join('\n')
    .trim();
}

function pathOf(symbolId: string): string | null {
  try {
    return parseSymbolId(symbolId).path;
  } catch {
    return null;
  }
}

function hydrate(store: MetadataStore, hits: RankedHit[]): z.infer<typeof hitSchema>[] {
  const symbols = new Map(store.symbolsByIds(hits.map((h) => h.symbolId)).map((s) => [s.id, s]));
  const chunks = new Map(store.chunksByIds(hits.map((h) => h.symbolId)).map((c) => [c.id, c]));
  return hits.map((h) => {
    const symbol = symbols.get(h.symbolId);
    const chunk = chunks.get(h.symbolId);
    return {
      symbolId: h.symbolId,
      score: h.score,
      source: h.source,
      name: symbol?.name ?? null,
      path: pathOf(h.symbolId),
      kind: symbol?.kind ?? null,
      snippet: chunk ? snippetOf(chunk.content) : null,
    };
  });
}

/** Drops undefined keys so the object satisfies exactOptionalPropertyTypes targets. */
function cleanFilters(filters: z.infer<typeof filtersSchema>): {
  kinds?: string[];
  pathPrefix?: string;
  language?: string;
} {
  return {
    ...(filters.kinds ? { kinds: filters.kinds } : {}),
    ...(filters.pathPrefix ? { pathPrefix: filters.pathPrefix } : {}),
    ...(filters.language ? { language: filters.language } : {}),
  };
}

async function runSearch(
  repo: RegisteredRepo,
  query: string,
  k: number,
  mode: 'hybrid' | 'semantic' | 'keyword',
  rawFilters: z.infer<typeof filtersSchema>,
): Promise<z.infer<typeof hitSchema>[]> {
  const filters = cleanFilters(rawFilters);
  if (mode === 'keyword') {
    const bm25 = new Bm25Retriever(repo.fts, repo.id);
    return hydrate(repo.store, await bm25.retrieve(query, { k, filters }));
  }
  if (mode === 'semantic') {
    const hits = await semanticSearch(
      { store: repo.store, vectors: repo.vectors, embedder: repo.embedder },
      repo.id,
      query,
      k,
      filters,
    );
    return hydrate(
      repo.store,
      hits.map((h) => ({ symbolId: h.symbolId, score: h.score, source: 'vector', provenance: {} })),
    );
  }
  const bm25 = new Bm25Retriever(repo.fts, repo.id);
  const vector = new VectorRetriever(
    { store: repo.store, vectors: repo.vectors, embedder: repo.embedder },
    repo.id,
  );
  const [bm25Hits, vectorHits] = await Promise.all([
    bm25.retrieve(query, { k, filters }),
    vector.retrieve(query, { k, filters }),
  ]);
  const fused = fuseRankedLists([bm25Hits, vectorHits]).slice(0, k);
  return hydrate(repo.store, fused);
}

/** `/v1/repos/:repo/search` — hybrid/semantic/keyword code search (issue #46). */
export function registerSearchRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/v1/repos/:repo/search',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        body: searchBodySchema,
        response: { 200: z.object({ hits: z.array(hitSchema) }) },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      const { query, k = 10, mode = 'hybrid', filters = {} } = request.body;
      const hits = await runSearch(repo, query, k, mode, filters);
      return { hits };
    },
  );
}
