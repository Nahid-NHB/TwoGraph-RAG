import { describe, expect, it } from 'vitest';
import type { RankedHit } from '@twograph/core';
import { fuseRankedLists } from '@twograph/retrieval';

function hit(symbolId: string, source: RankedHit['source'], graphPath?: string): RankedHit {
  return { symbolId, score: 0, source, provenance: {}, ...(graphPath ? { graphPath } : {}) };
}

describe('fuseRankedLists', () => {
  it('reproduces a known RRF worked example (k=1)', () => {
    // bm25 ranks: s1=1, s2=2, s3=3 — vector ranks: s2=1, s1=2
    // RRF(s1) = 1/(1+1) + 1/(1+2) = 0.5 + 0.3333... = 0.8333...
    // RRF(s2) = 1/(1+2) + 1/(1+1) = 0.3333... + 0.5   = 0.8333... (tie with s1)
    // RRF(s3) = 1/(1+3)                                = 0.25
    const bm25 = [hit('s1', 'bm25'), hit('s2', 'bm25'), hit('s3', 'bm25')];
    const vector = [hit('s2', 'vector'), hit('s1', 'vector')];

    const fused = fuseRankedLists([bm25, vector], { k: 1 });

    expect(fused.map((h) => h.symbolId)).toEqual(['s1', 's2', 's3']);
    expect(fused[0]?.score).toBeCloseTo(1 / 2 + 1 / 3, 10);
    expect(fused[1]?.score).toBeCloseTo(1 / 3 + 1 / 2, 10);
    expect(fused[2]?.score).toBeCloseTo(1 / 4, 10);
    expect(fused.every((h) => h.source === 'fused')).toBe(true);
  });

  it('defaults k to 60 per the retrieval pipeline spec', () => {
    const fused = fuseRankedLists([[hit('s1', 'bm25')]]);
    expect(fused[0]?.score).toBeCloseTo(1 / 61, 10);
  });

  it('dedups by symbolId, keeping per-source ranks and the first graphPath seen', () => {
    const bm25 = [hit('shared', 'bm25'), hit('bm25-only', 'bm25')];
    const graph = [hit('shared', 'graph', 'caller → shared'), hit('graph-only', 'graph')];

    const fused = fuseRankedLists([bm25, graph]);
    const shared = fused.find((h) => h.symbolId === 'shared');

    expect(shared?.provenance).toEqual({ bm25: 1, graph: 1 });
    expect(shared?.graphPath).toBe('caller → shared');
    expect(fused.some((h) => h.symbolId === 'bm25-only')).toBe(true);
    expect(fused.some((h) => h.symbolId === 'graph-only')).toBe(true);
  });

  it('keeps the best (lowest) rank when a source lists a symbol more than once', () => {
    // Not typical for one retriever, but fusion should still be well-defined.
    const listA = [hit('x', 'bm25'), hit('y', 'bm25'), hit('x', 'bm25')];
    const fused = fuseRankedLists([listA]);
    expect(fused.find((h) => h.symbolId === 'x')?.provenance).toEqual({ bm25: 1 });
  });

  it('breaks ties deterministically by symbolId', () => {
    const listA = [hit('zebra', 'bm25'), hit('alpha', 'bm25')];
    const fused = fuseRankedLists([listA, [...listA].reverse()]);
    // Both symbols end up with identical fused scores (each ranked 1 and 2 once).
    expect(fused[0]?.score).toBe(fused[1]?.score);
    expect(fused.map((h) => h.symbolId)).toEqual(['alpha', 'zebra']);
  });

  it('returns an empty array for no input lists or all-empty lists', () => {
    expect(fuseRankedLists([])).toEqual([]);
    expect(fuseRankedLists([[], []])).toEqual([]);
  });
});
