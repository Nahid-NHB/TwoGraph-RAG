// Measured cache speedup (issue #71, acceptance criterion "measured speedup
// documented in bench report"): a hot GraphQueries read, cold (real Cypher
// round trip) vs warm (generation-keyed LRU hit against the exact same repo
// + args), against the real Memgraph-backed fixture.
import { GraphQueries } from '@twograph/graph';

const SYMBOL = 'auth/jwt.ts#verifyToken';

export async function runCachingBench(fixture) {
  const cachedQueries = new GraphQueries(fixture.graphClient, { getGeneration: () => 1 });
  const symbolId = `${fixture.repo}:${SYMBOL}`;

  const coldStart = performance.now();
  await cachedQueries.callers(fixture.repo, symbolId, 2);
  const coldMs = performance.now() - coldStart;

  const warmStart = performance.now();
  await cachedQueries.callers(fixture.repo, symbolId, 2);
  // Floor avoids a divide-by-near-zero blowup — a cache hit is often faster
  // than performance.now()'s resolution can distinguish from zero.
  const warmMs = Math.max(performance.now() - warmStart, 0.001);

  return {
    'caching.graphQueryColdMs': { value: coldMs, unit: 'ms', direction: 'lower-is-better' },
    'caching.graphQueryWarmMs': { value: warmMs, unit: 'ms', direction: 'lower-is-better' },
    'caching.graphQuerySpeedupX': {
      value: coldMs / warmMs,
      unit: 'x',
      direction: 'higher-is-better',
    },
  };
}
