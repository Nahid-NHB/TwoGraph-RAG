import { basename, join, resolve } from 'node:path';
import { hashContent, loadConfig, type TwoGraphConfig } from '@twograph/core';
import { GraphClient } from '@twograph/graph';
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
  embedder: Embedder;
  vectors: VectorStore;
  close(): Promise<void>;
}

export function resolveRepoRoot(pathArg: string | undefined, cwd: string): string {
  return pathArg ? resolve(cwd, pathArg) : resolve(cwd);
}

/** Derived from the resolved root path so `index` and `search` agree on repo identity. */
export function repoIdFor(rootPath: string): string {
  return hashContent(rootPath);
}

/** Opens every store the CLI needs against a repo root, sharing one config load. */
export function openRepoContext(rootPath: string): RepoContext {
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
    embedder,
    vectors,
    close: () => graphClient.close(),
  };
}
