import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ParsedFile } from '@twograph/core';

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

  markChunksEmbedded(chunkIds: string[]): void {
    if (chunkIds.length === 0) return;
    const placeholders = chunkIds.map(() => '?').join(',');
    this.db
      .prepare(`UPDATE chunks SET embedded_at = datetime('now') WHERE id IN (${placeholders})`)
      .run(...chunkIds);
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
