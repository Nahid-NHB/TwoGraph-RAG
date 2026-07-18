export { openDatabase, type DatabaseSync } from './db.js';
export { applyMigrations, MIGRATIONS } from './migrations.js';
export {
  MetadataStore,
  type FileRow,
  type IndexRunRow,
  type RepoRow,
  type SymbolRow,
} from './repositories.js';
