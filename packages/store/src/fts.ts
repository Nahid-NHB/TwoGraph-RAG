import type { DatabaseSync } from 'node:sqlite';

/**
 * Splits code text into search tokens: identifiers are broken on camelCase,
 * snake_case, and digits, lowercased, deduplicated. This is what lets the
 * query "fetch user" hit `fetchUser` (issue #30).
 */
export function splitIdentifiers(text: string): string[] {
  const tokens = new Set<string>();
  for (const word of text.match(/[A-Za-z$_][A-Za-z0-9$_]*/g) ?? []) {
    tokens.add(word.toLowerCase());
    const parts = word
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[_$\s]+/)
      .filter((p) => p.length > 1);
    for (const part of parts) tokens.add(part.toLowerCase());
  }
  return [...tokens];
}

export interface FtsChunkRow {
  chunkId: string;
  repo: string;
  content: string;
  name: string;
  path: string;
  kind: string;
}

export interface Bm25Hit {
  chunkId: string;
  score: number;
  name: string;
  path: string;
  kind: string;
  snippet: string;
}

export interface Bm25Filters {
  kinds?: string[];
  pathPrefix?: string;
}

/** BM25 keyword index over chunks. Kept in sync explicitly by the indexer. */
export class FtsIndex {
  constructor(private readonly db: DatabaseSync) {}

  /** Replaces all FTS rows for the given chunk ids, then inserts fresh ones. */
  upsert(rows: FtsChunkRow[]): void {
    if (rows.length === 0) return;
    const del = this.db.prepare(`DELETE FROM chunks_fts WHERE chunk_id = ?`);
    const ins = this.db.prepare(
      `INSERT INTO chunks_fts (content, name, path, kind, tokens, chunk_id, repo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      del.run(row.chunkId);
      ins.run(
        row.content,
        row.name,
        row.path,
        row.kind,
        splitIdentifiers(`${row.name} ${row.content}`).join(' '),
        row.chunkId,
        row.repo,
      );
    }
  }

  /** Removes FTS rows for a file (chunks table cascades separately). */
  deleteByPath(repo: string, path: string): void {
    this.db.prepare(`DELETE FROM chunks_fts WHERE repo = ? AND path = ?`).run(repo, path);
  }

  deleteByRepo(repo: string): void {
    this.db.prepare(`DELETE FROM chunks_fts WHERE repo = ?`).run(repo);
  }

  /**
   * BM25 search with identifier-aware query expansion. Name matches are
   * boosted over path/token/content matches. Lower bm25 = better; scores
   * are returned negated so higher = better for fusion.
   */
  search(repo: string, query: string, k = 20, filters: Bm25Filters = {}): Bm25Hit[] {
    const tokens = splitIdentifiers(query);
    if (tokens.length === 0) return [];
    const match = tokens.map((t) => `"${t.replaceAll('"', '')}"`).join(' OR ');

    let where = `chunks_fts MATCH ? AND repo = ?`;
    const params: unknown[] = [match, repo];
    if (filters.kinds && filters.kinds.length > 0) {
      where += ` AND kind IN (${filters.kinds.map(() => '?').join(',')})`;
      params.push(...filters.kinds);
    }
    if (filters.pathPrefix) {
      where += ` AND path LIKE ?`;
      params.push(`${filters.pathPrefix}%`);
    }

    const rows = this.db
      .prepare(
        `SELECT chunk_id, name, path, kind,
                bm25(chunks_fts, 1.0, 6.0, 2.0, 1.0, 3.0) AS score,
                snippet(chunks_fts, 0, '', '', '…', 16) AS snip
         FROM chunks_fts
         WHERE ${where}
         ORDER BY score
         LIMIT ?`,
      )
      .all(...(params as string[]), k) as unknown as {
      chunk_id: string;
      name: string;
      path: string;
      kind: string;
      score: number;
      snip: string;
    }[];

    return rows.map((r) => ({
      chunkId: r.chunk_id,
      score: -r.score,
      name: r.name,
      path: r.path,
      kind: r.kind,
      snippet: r.snip,
    }));
  }
}
