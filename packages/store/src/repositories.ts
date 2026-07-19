import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Citation, ParsedFile } from '@twograph/core';

export interface RepoRow {
  id: string;
  root_path: string;
  name: string;
  created_at: string;
  last_indexed: string | null;
}

export interface FileRow {
  id: string;
  repo_id: string;
  rel_path: string;
  language: string;
  content_hash: string;
  size_bytes: number;
  indexed_at: string;
}

export interface SymbolRow {
  id: string;
  file_id: string;
  repo_id: string;
  kind: string;
  name: string;
  qualified: string;
  signature: string | null;
  doc: string | null;
  start_line: number;
  end_line: number;
  exported: number;
  content_hash: string;
}

export interface ChunkRow {
  id: string;
  symbol_id: string;
  repo_id: string;
  content: string;
  content_hash: string;
  embedded_at: string | null;
}

export interface ChatSessionRow {
  id: string;
  repo_id: string;
  title: string | null;
  created_at: string;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations_json: string | null;
  created_at: string;
}

export type EditStatus = 'pending' | 'applied' | 'rejected' | 'expired' | 'reverted';

export interface EditRow {
  id: string;
  repo_id: string;
  operation: string;
  params_json: string;
  diff: string;
  status: EditStatus;
  created_at: string;
  resolved_at: string | null;
  /** JSON `Record<path, hash>` — content hash of each affected file at preview time. */
  file_hashes_json: string;
  /** Caller-defined JSON blob capturing what's needed to revert — populated only once applied. */
  applied_files_json: string | null;
}

export interface IndexRunRow {
  id: string;
  repo_id: string;
  kind: string;
  files_added: number;
  files_changed: number;
  files_removed: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

/** Typed data access over the metadata database (issue #29). */
export class MetadataStore {
  constructor(readonly db: DatabaseSync) {}

  // ---- repositories ----
  upsertRepository(repo: { id: string; rootPath: string; name: string }): void {
    this.db
      .prepare(
        `INSERT INTO repositories (id, root_path, name) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET root_path = excluded.root_path, name = excluded.name`,
      )
      .run(repo.id, repo.rootPath, repo.name);
  }

  getRepository(id: string): RepoRow | undefined {
    return this.db.prepare(`SELECT * FROM repositories WHERE id = ?`).get(id) as
      RepoRow | undefined;
  }

  listRepositories(): RepoRow[] {
    return this.db.prepare(`SELECT * FROM repositories ORDER BY id`).all() as unknown as RepoRow[];
  }

  touchRepository(id: string): void {
    this.db.prepare(`UPDATE repositories SET last_indexed = datetime('now') WHERE id = ?`).run(id);
  }

  // ---- files & symbols ----
  /** Current content hashes per path — drives the incremental diff. */
  fileHashes(repoId: string): Map<string, string> {
    const rows = this.db
      .prepare(`SELECT rel_path, content_hash FROM files WHERE repo_id = ?`)
      .all(repoId) as unknown as Pick<FileRow, 'rel_path' | 'content_hash'>[];
    return new Map(rows.map((r) => [r.rel_path, r.content_hash]));
  }

  /** Replaces a file row and all its symbols (chunks cascade too). */
  replaceFile(parsed: ParsedFile, sizeBytes: number): void {
    const fileId = `${parsed.repo}:${parsed.path}`;
    const tx = () => {
      this.db.prepare(`DELETE FROM files WHERE id = ?`).run(fileId);
      this.db
        .prepare(
          `INSERT INTO files (id, repo_id, rel_path, language, content_hash, size_bytes)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(fileId, parsed.repo, parsed.path, parsed.language, parsed.contentHash, sizeBytes);
      const insert = this.db.prepare(
        `INSERT INTO symbols (id, file_id, repo_id, kind, name, qualified, signature, doc,
                              start_line, end_line, exported, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of parsed.symbols) {
        insert.run(
          s.id,
          fileId,
          s.repo,
          s.kind,
          s.name,
          s.qualifiedName,
          s.signature ?? null,
          s.doc?.summary ?? null,
          s.span.startLine,
          s.span.endLine,
          s.exported ? 1 : 0,
          s.contentHash,
        );
      }
    };
    this.transaction(tx);
  }

  deleteFile(repoId: string, relPath: string): void {
    this.db.prepare(`DELETE FROM files WHERE repo_id = ? AND rel_path = ?`).run(repoId, relPath);
  }

  getSymbol(id: string): SymbolRow | undefined {
    return this.db.prepare(`SELECT * FROM symbols WHERE id = ?`).get(id) as SymbolRow | undefined;
  }

  symbolsByFile(fileId: string): SymbolRow[] {
    return this.db
      .prepare(`SELECT * FROM symbols WHERE file_id = ? ORDER BY start_line`)
      .all(fileId) as unknown as SymbolRow[];
  }

  symbolsByIds(ids: string[]): SymbolRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .prepare(`SELECT * FROM symbols WHERE id IN (${placeholders})`)
      .all(...ids) as unknown as SymbolRow[];
  }

  // ---- chunks (embedding bookkeeping) ----
  /** content_hash + embedded_at per chunk id for the given file's symbols. */
  chunkStates(symbolIds: string[]): Map<string, { hash: string; embeddedAt: string | null }> {
    if (symbolIds.length === 0) return new Map();
    const placeholders = symbolIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, content_hash, embedded_at FROM chunks WHERE symbol_id IN (${placeholders})`,
      )
      .all(...symbolIds) as unknown as {
      id: string;
      content_hash: string;
      embedded_at: string | null;
    }[];
    return new Map(rows.map((r) => [r.id, { hash: r.content_hash, embeddedAt: r.embedded_at }]));
  }

  /** Inserts chunks, carrying over embedded_at where the content is unchanged. */
  insertChunks(
    chunks: { id: string; symbolId: string; repo: string; content: string; contentHash: string }[],
    carryOver: Map<string, { hash: string; embeddedAt: string | null }>,
  ): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO chunks (id, symbol_id, repo_id, content, content_hash, embedded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const chunk of chunks) {
      const prior = carryOver.get(chunk.id);
      const embeddedAt = prior && prior.hash === chunk.contentHash ? prior.embeddedAt : null;
      insert.run(
        chunk.id,
        chunk.symbolId,
        chunk.repo,
        chunk.content,
        chunk.contentHash,
        embeddedAt,
      );
    }
  }

  chunksByIds(ids: string[]): ChunkRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`)
      .all(...ids) as unknown as ChunkRow[];
  }

  markChunksEmbedded(chunkIds: string[]): void {
    if (chunkIds.length === 0) return;
    const placeholders = chunkIds.map(() => '?').join(',');
    this.db
      .prepare(`UPDATE chunks SET embedded_at = datetime('now') WHERE id IN (${placeholders})`)
      .run(...chunkIds);
  }

  // ---- chat sessions & messages (issue #45) ----
  createChatSession(repoId: string, title?: string): ChatSessionRow {
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO chat_sessions (id, repo_id, title) VALUES (?, ?, ?)`)
      .run(id, repoId, title ?? null);
    const row = this.getChatSession(id);
    if (!row) throw new Error(`failed to create chat session ${id}`);
    return row;
  }

  getChatSession(id: string): ChatSessionRow | undefined {
    return this.db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(id) as
      ChatSessionRow | undefined;
  }

  /** Returns the repo's most recent session, creating one if none exists — the
   * "implicit session" the CLI uses so repeated `twograph query` calls chain. */
  getOrCreateImplicitSession(repoId: string): ChatSessionRow {
    const existing = this.db
      .prepare(`SELECT * FROM chat_sessions WHERE repo_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(repoId) as ChatSessionRow | undefined;
    return existing ?? this.createChatSession(repoId);
  }

  listChatSessions(repoId: string): ChatSessionRow[] {
    return this.db
      .prepare(`SELECT * FROM chat_sessions WHERE repo_id = ? ORDER BY created_at`)
      .all(repoId) as unknown as ChatSessionRow[];
  }

  addChatMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    citations: Citation[] = [],
  ): ChatMessageRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, citations_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, role, content, citations.length > 0 ? JSON.stringify(citations) : null);
    const row = this.db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id) as
      ChatMessageRow | undefined;
    if (!row) throw new Error(`failed to add chat message ${id}`);
    return row;
  }

  listChatMessages(sessionId: string): ChatMessageRow[] {
    return this.db
      .prepare(`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at`)
      .all(sessionId) as unknown as ChatMessageRow[];
  }

  // ---- index runs ----
  startIndexRun(repoId: string, kind: 'full' | 'incremental' | 'watch'): string {
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO index_runs (id, repo_id, kind) VALUES (?, ?, ?)`)
      .run(id, repoId, kind);
    return id;
  }

  finishIndexRun(
    id: string,
    stats: { added: number; changed: number; removed: number },
    error?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE index_runs SET files_added = ?, files_changed = ?, files_removed = ?,
                finished_at = datetime('now'), error = ? WHERE id = ?`,
      )
      .run(stats.added, stats.changed, stats.removed, error ?? null, id);
  }

  getIndexRun(id: string): IndexRunRow | undefined {
    return this.db.prepare(`SELECT * FROM index_runs WHERE id = ?`).get(id) as
      IndexRunRow | undefined;
  }

  // ---- edits (issue #49) ----
  createEdit(
    repoId: string,
    operation: string,
    paramsJson: string,
    diff: string,
    fileHashes: Record<string, string>,
  ): EditRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO edits (id, repo_id, operation, params_json, diff, file_hashes_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, repoId, operation, paramsJson, diff, JSON.stringify(fileHashes));
    const row = this.getEdit(id);
    if (!row) throw new Error(`failed to create edit ${id}`);
    return row;
  }

  getEdit(id: string): EditRow | undefined {
    return this.db.prepare(`SELECT * FROM edits WHERE id = ?`).get(id) as EditRow | undefined;
  }

  listEdits(repoId: string, status?: EditStatus): EditRow[] {
    if (status) {
      return this.db
        .prepare(`SELECT * FROM edits WHERE repo_id = ? AND status = ? ORDER BY created_at DESC`)
        .all(repoId, status) as unknown as EditRow[];
    }
    return this.db
      .prepare(`SELECT * FROM edits WHERE repo_id = ? ORDER BY created_at DESC`)
      .all(repoId) as unknown as EditRow[];
  }

  /** Age comparison done in SQL to avoid JS-side timezone parsing of SQLite's `datetime('now')` text. */
  isEditExpired(id: string, ttlMs: number): boolean {
    const row = this.db
      .prepare(
        `SELECT (julianday('now') - julianday(created_at)) * 86400000.0 > ? AS expired
         FROM edits WHERE id = ?`,
      )
      .get(ttlMs, id) as { expired: number } | undefined;
    return row ? Boolean(row.expired) : false;
  }

  /** `appliedFilesJson` is a caller-serialized JSON blob — its shape is an editing-package concern. */
  resolveEdit(id: string, status: EditStatus, appliedFilesJson?: string): void {
    this.db
      .prepare(
        `UPDATE edits SET status = ?, resolved_at = datetime('now'), applied_files_json = ?
         WHERE id = ?`,
      )
      .run(status, appliedFilesJson ?? null, id);
  }

  /** Runs `fn` inside an immediate transaction with rollback on throw. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
