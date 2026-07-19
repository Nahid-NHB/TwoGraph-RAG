export { openDatabase, type DatabaseSync } from './db.js';
export { applyMigrations, MIGRATIONS } from './migrations.js';
export {
  FtsIndex,
  splitIdentifiers,
  type Bm25Filters,
  type Bm25Hit,
  type FtsChunkRow,
} from './fts.js';
export {
  MetadataStore,
  type ChatMessageRow,
  type ChatSessionRow,
  type ChunkRow,
  type EditRow,
  type EditStatus,
  type FileRow,
  type IndexRunRow,
  type RepoRow,
  type SymbolRow,
} from './repositories.js';
