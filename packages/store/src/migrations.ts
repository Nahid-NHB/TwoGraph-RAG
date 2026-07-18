import type { DatabaseSync } from 'node:sqlite';

/** Ordered migrations; each runs once, tracked in `meta.schema_version`. */
export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE repositories (
        id           TEXT PRIMARY KEY,
        root_path    TEXT NOT NULL,
        name         TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        last_indexed TEXT
      );

      CREATE TABLE files (
        id           TEXT PRIMARY KEY,
        repo_id      TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        rel_path     TEXT NOT NULL,
        language     TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes   INTEGER NOT NULL DEFAULT 0,
        indexed_at   TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (repo_id, rel_path)
      );

      CREATE TABLE symbols (
        id           TEXT PRIMARY KEY,
        file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        repo_id      TEXT NOT NULL,
        kind         TEXT NOT NULL,
        name         TEXT NOT NULL,
        qualified    TEXT NOT NULL,
        signature    TEXT,
        doc          TEXT,
        start_line   INTEGER NOT NULL,
        end_line     INTEGER NOT NULL,
        exported     INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL
      );
      CREATE INDEX idx_symbols_file ON symbols(file_id);
      CREATE INDEX idx_symbols_kind ON symbols(repo_id, kind);
      CREATE INDEX idx_symbols_name ON symbols(repo_id, name);

      CREATE TABLE chunks (
        id           TEXT PRIMARY KEY,
        symbol_id    TEXT NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
        repo_id      TEXT NOT NULL,
        content      TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedded_at  TEXT
      );
      CREATE INDEX idx_chunks_symbol ON chunks(symbol_id);
      CREATE INDEX idx_chunks_pending ON chunks(repo_id, embedded_at);

      CREATE TABLE edits (
        id                 TEXT PRIMARY KEY,
        repo_id            TEXT NOT NULL,
        operation          TEXT NOT NULL,
        params_json        TEXT NOT NULL,
        diff               TEXT NOT NULL,
        status             TEXT NOT NULL DEFAULT 'pending',
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at        TEXT,
        file_hashes_json   TEXT NOT NULL DEFAULT '{}',
        applied_files_json TEXT
      );
      CREATE INDEX idx_edits_repo ON edits(repo_id, status);

      CREATE TABLE chat_sessions (
        id         TEXT PRIMARY KEY,
        repo_id    TEXT NOT NULL,
        title      TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE chat_messages (
        id             TEXT PRIMARY KEY,
        session_id     TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role           TEXT NOT NULL,
        content        TEXT NOT NULL,
        citations_json TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_messages_session ON chat_messages(session_id, created_at);

      CREATE TABLE index_runs (
        id            TEXT PRIMARY KEY,
        repo_id       TEXT NOT NULL,
        kind          TEXT NOT NULL,
        files_added   INTEGER NOT NULL DEFAULT 0,
        files_changed INTEGER NOT NULL DEFAULT 0,
        files_removed INTEGER NOT NULL DEFAULT 0,
        started_at    TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at   TEXT,
        error         TEXT
      );
    `,
  },
];

export function applyMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    { value: string } | undefined;
  let current = row ? Number(row.value) : 0;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(String(migration.version));
      db.exec('COMMIT');
      current = migration.version;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
