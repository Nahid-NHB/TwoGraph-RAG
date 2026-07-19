import type { RankedHit } from '@twograph/core';

export interface FuseOptions {
  /** RRF k — larger values flatten the influence of rank differences. */
  k?: number;
}

/**
 * Reciprocal Rank Fusion (docs/07 §4): RRF(d) = Σ_lists 1 / (k + rank_list(d)).
 * Ranks only — no cross-retriever score normalization. Dedupes by symbolId,
 * merging per-source ranks into `provenance` and keeping the first graphPath
 * seen. Ties break on symbolId so output order is fully deterministic.
 */
export function fuseRankedLists(lists: RankedHit[][], options: FuseOptions = {}): RankedHit[] {
  const k = options.k ?? 60;
  const entries = new Map<
    string,
    { score: number; provenance: Record<string, number>; graphPath?: string }
  >();

  for (const list of lists) {
    list.forEach((hit, index) => {
      const rank = index + 1;
      let entry = entries.get(hit.symbolId);
      if (!entry) {
        entry = { score: 0, provenance: {} };
        entries.set(hit.symbolId, entry);
      }
      entry.score += 1 / (k + rank);
      const priorRank = entry.provenance[hit.source];
      if (priorRank === undefined || rank < priorRank) {
        entry.provenance[hit.source] = rank;
      }
      if (hit.graphPath && !entry.graphPath) {
        entry.graphPath = hit.graphPath;
      }
    });
  }

  return [...entries.entries()]
    .map(([symbolId, entry]) => ({
      symbolId,
      score: entry.score,
      source: 'fused' as const,
      ...(entry.graphPath ? { graphPath: entry.graphPath } : {}),
      provenance: entry.provenance,
    }))
    .sort((a, b) => b.score - a.score || a.symbolId.localeCompare(b.symbolId));
}
