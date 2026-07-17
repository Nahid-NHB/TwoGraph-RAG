# Database Schema

Two search/metadata stores complement the knowledge graph. All rows join on **stable symbol IDs** (`repo:relPath#qualifiedName`). Everything here is derived state and rebuildable.

## 1. SQLite (`@twograph/store`, better-sqlite3, WAL mode)

```sql
CREATE TABLE repositories (
  id           TEXT PRIMARY KEY,          -- slug
  root_path    TEXT NOT NULL,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_indexed TEXT
);

CREATE TABLE files (
  id           TEXT PRIMARY KEY,          -- repo:relPath
  repo_id      TEXT NOT NULL REFERENCES repositories(id),
  rel_path     TEXT NOT NULL,
  language     TEXT NOT NULL,             -- js|ts|jsx|tsx|json|other
  content_hash TEXT NOT NULL,             -- xxhash64 of contents
  size_bytes   INTEGER NOT NULL,
  indexed_at   TEXT NOT NULL,
  UNIQUE (repo_id, rel_path)
);

CREATE TABLE symbols (
  id           TEXT PRIMARY KEY,          -- stable symbol id
  file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  repo_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,             -- function|class|method|hook|component|interface|enum|variable|route|...
  name         TEXT NOT NULL,
  qualified    TEXT NOT NULL,
  signature    TEXT,
  doc          TEXT,
  start_line   INTEGER NOT NULL,
  end_line     INTEGER NOT NULL,
  exported     INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL              -- hash of symbol source; gates re-embedding
);
CREATE INDEX idx_symbols_file ON symbols(file_id);
CREATE INDEX idx_symbols_kind ON symbols(repo_id, kind);

CREATE TABLE chunks (
  id           TEXT PRIMARY KEY,          -- symbolId[:partN]
  symbol_id    TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  repo_id      TEXT NOT NULL,
  content      TEXT NOT NULL,             -- enriched chunk text (signature + doc + body)
  content_hash TEXT NOT NULL,
  embedded_at  TEXT                       -- NULL = pending embedding
);

-- BM25 index (FTS5, bm25() ranking). Kept in sync with chunks via triggers.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content, name, path, kind,
  content='',                             -- contentless; rowid ↔ chunks map table
  tokenize="unicode61 tokenchars '_$'"
);

CREATE TABLE edits (
  id           TEXT PRIMARY KEY,
  repo_id      TEXT NOT NULL,
  operation    TEXT NOT NULL,             -- rename|move|extract|add_param|remove_param|imports|custom
  params_json  TEXT NOT NULL,
  diff         TEXT NOT NULL,             -- unified diff preview
  status       TEXT NOT NULL,             -- pending|approved|applied|rejected|expired|reverted
  created_at   TEXT NOT NULL,
  resolved_at  TEXT,
  applied_files_json TEXT                 -- pre-images for revert
);

CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, title TEXT, created_at TEXT NOT NULL
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                     -- user|assistant
  content TEXT NOT NULL,
  citations_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE index_runs (
  id TEXT PRIMARY KEY, repo_id TEXT NOT NULL,
  kind TEXT NOT NULL,                     -- full|incremental|watch
  files_added INTEGER, files_changed INTEGER, files_removed INTEGER,
  started_at TEXT NOT NULL, finished_at TEXT, error TEXT
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- schema_version, embedder id, etc.
```

Migrations: numbered SQL files applied at startup, version tracked in `meta`.

## 2. Qdrant

One collection per embedder model (so model swaps don't corrupt scores):

```
collection: twograph_unixcoder_768
  vector: size 768, distance Cosine
  payload (indexed fields *):
    chunk_id     string
    symbol_id*   string
    repo_id*     string
    kind*        string        # function|component|hook|...
    path*        string        # rel path (used for glob→prefix filters)
    language*    string
    name         string
    exported     bool
```

- Point ID = UUIDv5 of `chunk_id`.
- Upsert-by-hash: unchanged chunks are never re-embedded (gated by `chunks.content_hash`).
- Deleting a file ⇒ delete points by `symbol_id` filter for that file's symbols.

## 3. Consistency model

- SQLite is the **source of truth for index bookkeeping** (what's indexed, at which hash).
- Graph, FTS, and Qdrant are updated per-file inside the indexing pipeline; a failed file marks the run partial and the file stays at its old hash, so the next run retries it.
- `twograph index --rebuild` wipes derived stores for a repo and re-runs (explicit only).
