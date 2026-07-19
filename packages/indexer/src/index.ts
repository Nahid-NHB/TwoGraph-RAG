export {
  diffFiles,
  discoverFiles,
  readSource,
  type DiffResult,
  type DiscoveredFile,
} from './discover.js';
export {
  Indexer,
  type IndexerDeps,
  type IndexProgress,
  type IndexRunResult,
  type IndexStage,
} from './pipeline.js';
export { semanticSearch, type SemanticHit, type SemanticSearchDeps } from './search.js';
