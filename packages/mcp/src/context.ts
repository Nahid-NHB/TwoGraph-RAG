import { basename, join, resolve } from 'node:path';
import { hashContent, loadConfig, type TwoGraphConfig } from '@twograph/core';
import { GraphClient, GraphQueries } from '@twograph/graph';
import { FtsIndex, MetadataStore, openDatabase } from '@twograph/store';
import {
  createEmbedder,
  QdrantVectorStore,
  type Embedder,
  type VectorStore,
} from '@twograph/vector';

export interface RepoContext {
  repo: { id: string; rootPath: string; name: string };
  config: TwoGraphConfig;
  store: MetadataStore;
  fts: FtsIndex;
  graphClient: GraphClient;
  graphQueries: GraphQueries;
  embedder: Embedder;
  vectors: VectorStore;
  close(): Promise<void>;
}

/** Derived from the resolved root path so CLI/MCP/server agree on repo identity. */
export function repoIdFor(rootPath: string): string {
  return hashContent(rootPath);
}

/**
 * Opens every store an MCP tool needs against an already-indexed repo root.
 * Mirrors `packages/cli/src/context.ts`'s `openRepoContext` — duplicated
 * rather than imported since `@twograph/cli` and `@twograph/mcp` are both
 * delivery surfaces and must not depend on each other.
 */
export function openRepoContext(repoPathArg: string): RepoContext {
  const rootPath = resolve(repoPathArg);
  const config = loadConfig({ cwd: rootPath });
  const repo = { id: repoIdFor(rootPath), rootPath, name: basename(rootPath) };
  const db = openDatabase(join(rootPath, '.twograph', 'store.db'));
  const embedder = createEmbedder(config.embedder.provider);
  const vectors = new QdrantVectorStore({
    url: config.qdrant.url,
    embedderId: embedder.id,
    dimensions: embedder.dimensions,
  });
  const graphClient = new GraphClient({ uri: config.memgraph.uri });
  return {
    repo,
    config,
    store: new MetadataStore(db),
    fts: new FtsIndex(db),
    graphClient,
    graphQueries: new GraphQueries(graphClient),
    embedder,
    vectors,
    close: () => graphClient.close(),
  };
}
