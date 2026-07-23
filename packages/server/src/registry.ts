import { basename, join } from 'node:path';
import {
  hashContent,
  loadConfig,
  LruCache,
  NotFoundError,
  type RankedHit,
  type TwoGraphConfig,
} from '@twograph/core';
import { GraphClient, GraphQueries } from '@twograph/graph';
import type { WatchHandle } from '@twograph/indexer';
import { createLlmProvider, type LlmProvider } from '@twograph/llm';
import { type MultiQueryResult } from '@twograph/rag';
import { CrossEncoderReranker, type Reranker } from '@twograph/retrieval';
import { FtsIndex, MetadataStore, openDatabase } from '@twograph/store';
import {
  createEmbedder,
  QdrantVectorStore,
  type Embedder,
  type VectorStore,
} from '@twograph/vector';

/** Per-repo LRU capacity for the search/multi-query caches (issue #71). */
const SEARCH_CACHE_SIZE = 500;
const MULTI_QUERY_CACHE_SIZE = 200;

export interface RegisteredRepo {
  id: string;
  rootPath: string;
  name: string;
  config: TwoGraphConfig;
  store: MetadataStore;
  fts: FtsIndex;
  graphClient: GraphClient;
  graphQueries: GraphQueries;
  embedder: Embedder;
  vectors: VectorStore;
  llm: LlmProvider;
  /** Shared across requests — the cross-encoder loads its ONNX model once (issue #47). */
  reranker: Reranker;
  /** Set while `POST /v1/repos/:repo/watch {enabled:true}` is active (issue #66). */
  watchHandle?: WatchHandle | undefined;
  /** Generation-keyed caches (issue #71), shared across every request for
   * this repo for the life of the process; see `store.repoGeneration`. */
  searchCache: LruCache<string, RankedHit[]>;
  multiQueryCache: LruCache<string, MultiQueryResult>;
}

/** Derived from the resolved root path, matching the CLI so both agree on repo identity. */
export function repoIdFor(rootPath: string): string {
  return hashContent(rootPath);
}

/**
 * In-memory registry of repos this server process has opened (issue #46).
 * Registration is idempotent by rootPath; each repo's own `.twograph/store.db`
 * and config are opened once and reused for the process lifetime.
 */
export class RepoRegistry {
  private readonly repos = new Map<string, RegisteredRepo>();

  /**
   * `overrides` lets tests substitute a dependency (e.g. a `MockLlmProvider`
   * with a configured stream delay) without the server ever needing to know
   * about test-only concerns itself.
   */
  register(
    rootPath: string,
    name?: string,
    overrides: Partial<RegisteredRepo> = {},
  ): RegisteredRepo {
    const id = repoIdFor(rootPath);
    const existing = this.repos.get(id);
    if (existing) return existing;

    const config = loadConfig({ cwd: rootPath });
    const db = openDatabase(join(rootPath, '.twograph', 'store.db'));
    const store = new MetadataStore(db);
    const embedder = createEmbedder(config.embedder.provider);
    const vectors = new QdrantVectorStore({
      url: config.qdrant.url,
      embedderId: embedder.id,
      dimensions: embedder.dimensions,
    });
    const graphClient = new GraphClient({ uri: config.memgraph.uri });
    const repoName = name ?? basename(rootPath);
    store.upsertRepository({ id, rootPath, name: repoName });

    const repo: RegisteredRepo = {
      id,
      rootPath,
      name: repoName,
      config,
      store,
      fts: new FtsIndex(db),
      graphClient,
      graphQueries: new GraphQueries(graphClient, {
        getGeneration: (r) => store.repoGeneration(r),
      }),
      embedder,
      vectors,
      llm: createLlmProvider(config),
      reranker: new CrossEncoderReranker(),
      searchCache: new LruCache(SEARCH_CACHE_SIZE),
      multiQueryCache: new LruCache(MULTI_QUERY_CACHE_SIZE),
      ...overrides,
    };
    this.repos.set(id, repo);
    return repo;
  }

  get(id: string): RegisteredRepo | undefined {
    return this.repos.get(id);
  }

  /** @throws NotFoundError if the repo id isn't registered on this server. */
  require(id: string): RegisteredRepo {
    const repo = this.repos.get(id);
    if (!repo) throw new NotFoundError(`repo not found: ${id}`);
    return repo;
  }

  list(): RegisteredRepo[] {
    return [...this.repos.values()];
  }

  async closeAll(): Promise<void> {
    for (const repo of this.repos.values()) {
      await repo.watchHandle?.close();
      await repo.graphClient.close();
    }
  }
}
