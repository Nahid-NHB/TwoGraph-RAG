import type { EditRow } from '@twograph/store';

export interface McpEditSummary {
  id: string;
  repo: string;
  operation: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  diff: string;
  affectedFiles: string[];
  params: Record<string, unknown>;
}

/** Mirrors `packages/server/src/routes/edits.ts`'s `toSummary` — same journal, same shape. */
export function toEditSummary(row: EditRow): McpEditSummary {
  const fileHashes = JSON.parse(row.file_hashes_json) as Record<string, string>;
  return {
    id: row.id,
    repo: row.repo_id,
    operation: row.operation,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    diff: row.diff,
    affectedFiles: Object.keys(fileHashes),
    params: JSON.parse(row.params_json) as Record<string, unknown>,
  };
}
