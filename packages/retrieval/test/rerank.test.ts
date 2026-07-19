import { describe, expect, it } from 'vitest';
import type { RankedHit } from '@twograph/core';
import {
  CrossEncoderReranker,
  maybeRerank,
  MockReranker,
  type RerankCandidate,
} from '@twograph/retrieval';

function hit(symbolId: string, score: number): RankedHit {
  return { symbolId, score, source: 'fused', provenance: {} };
}

describe('MockReranker', () => {
  it('promotes a candidate with strong query overlap over a weakly-ranked one', async () => {
    // "weak" ranks first out of fusion (higher initial score) despite having
    // nothing to do with the query; "strong" ranks second but is the real match.
    const candidates: RerankCandidate[] = [
      {
        hit: hit('weak', 10),
        content: 'const palette = ["red","green"]; function paintCanvas() {}',
      },
      {
        hit: hit('strong', 1),
        content: 'export function verifyToken(token) { return validateJWT(token); }',
      },
    ];

    const reranked = await new MockReranker().rerank('verify token', candidates);

    expect(reranked.map((h) => h.symbolId)).toEqual(['strong', 'weak']);
  });

  it('respects k', async () => {
    const candidates: RerankCandidate[] = [
      { hit: hit('a', 1), content: 'token verify' },
      { hit: hit('b', 1), content: 'token' },
      { hit: hit('c', 1), content: 'nothing relevant' },
    ];
    const reranked = await new MockReranker().rerank('token verify', candidates, 2);
    expect(reranked).toHaveLength(2);
  });
});

describe('maybeRerank', () => {
  const candidates: RerankCandidate[] = [
    { hit: hit('a', 1), content: 'irrelevant' },
    { hit: hit('b', 2), content: 'verify token' },
  ];

  it('passes the fused order through untouched when disabled', async () => {
    const result = await maybeRerank(false, new MockReranker(), 'verify token', candidates);
    expect(result.map((h) => h.symbolId)).toEqual(['a', 'b']);
  });

  it('truncates to k when disabled', async () => {
    const result = await maybeRerank(false, new MockReranker(), 'verify token', candidates, 1);
    expect(result.map((h) => h.symbolId)).toEqual(['a']);
  });

  it('delegates to the reranker when enabled', async () => {
    const result = await maybeRerank(true, new MockReranker(), 'verify token', candidates);
    expect(result.map((h) => h.symbolId)).toEqual(['b', 'a']);
  });
});

// Real cross-encoder smoke test — requires network/model download; opt-in only.
describe.skipIf(!process.env['TWOGRAPH_TEST_REAL_RERANKER'])('CrossEncoderReranker (real)', () => {
  it('ranks the relevant chunk first and meets the p95 latency budget for 50 candidates', async () => {
    const reranker = new CrossEncoderReranker();
    const relevant: RerankCandidate = {
      hit: hit('relevant', 0),
      content: 'export function verifyToken(token) { return validateJWT(token); }',
    };
    const noise: RerankCandidate[] = Array.from({ length: 49 }, (_, i) => ({
      hit: hit(`noise-${String(i)}`, 0),
      content: `function paintCanvas${String(i)}() { return ${String(i)}; }`,
    }));

    // Warm up: exclude model download/load time from the latency assertion below.
    await reranker.rerank('warmup', [relevant]);

    const started = performance.now();
    const reranked = await reranker.rerank('verify a jwt token', [relevant, ...noise]);
    const elapsed = performance.now() - started;

    expect(reranked[0]?.symbolId).toBe('relevant');
    expect(elapsed).toBeLessThan(300);
  }, 300_000);
});
