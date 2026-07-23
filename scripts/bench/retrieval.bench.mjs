// Hybrid search p95 latency (NFR-3, excl. LLM) and golden-set retrieval
// quality (docs/07-retrieval-pipeline.md). Deliberately skips the RAG
// pipeline's multiquery/generate stages (both LLM calls) so latency reflects
// retrieval alone; "citation precision" is approximated as precision@k of the
// assembled (would-be-cited) context against the golden set's expected
// files, since gating on real LLM citation text would make the CI check
// non-deterministic.
import { fuseRankedLists, expandSeeds, maybeRerank } from '@twograph/retrieval';
import { parseSymbolId } from '@twograph/core';
import { GOLDEN_SET } from './golden-set.mjs';

const TOP_K_PER_RETRIEVER = 20;
const TOP_SEEDS_FOR_EXPANSION = 10;
const TOP_CANDIDATES_FOR_RERANK = 50;
const K = 5;

function hydrateForRerank(store, hits) {
  const chunks = store.chunksByIds(hits.map((h) => h.symbolId));
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return hits.map((hit) => ({ hit, content: byId.get(hit.symbolId)?.content ?? '' }));
}

async function hybridSearch(fixture, question, k) {
  const { bm25, vector, graph, reranker } = fixture.retrieval;
  const [bm25Hits, vectorHits, graphHits] = await Promise.all([
    bm25.retrieve(question, { k: TOP_K_PER_RETRIEVER }),
    vector.retrieve(question, { k: TOP_K_PER_RETRIEVER }),
    graph.retrieve(question, { k: TOP_K_PER_RETRIEVER }),
  ]);
  const seeds = [...bm25Hits, ...vectorHits].sort((a, b) => b.score - a.score);
  const expansionHits = await expandSeeds(fixture.graphQueries, fixture.repo, seeds, {
    topSeeds: TOP_SEEDS_FOR_EXPANSION,
  });
  const fused = fuseRankedLists([bm25Hits, vectorHits, graphHits, expansionHits]);
  const candidates = hydrateForRerank(fixture.store, fused.slice(0, TOP_CANDIDATES_FOR_RERANK));
  const reranked = await maybeRerank(true, reranker, question, candidates);
  return reranked.slice(0, k);
}

function fileOf(symbolId) {
  return parseSymbolId(symbolId).path;
}

export async function runRetrievalBench(fixture) {
  await hybridSearch(fixture, 'warmup query token identifier', K); // JIT/connection warmup, excluded

  const latencies = [];
  let recallSum = 0;
  let precisionSum = 0;

  for (const { question, expectedFiles } of GOLDEN_SET) {
    const started = performance.now();
    const hits = await hybridSearch(fixture, question, K);
    latencies.push(performance.now() - started);

    const expected = new Set(expectedFiles);
    const retrievedFiles = hits.map((h) => fileOf(h.symbolId));
    const relevantRetrieved = retrievedFiles.filter((f) => expected.has(f)).length;
    recallSum += Math.min(relevantRetrieved, expected.size) / expected.size;
    precisionSum += hits.length > 0 ? relevantRetrieved / hits.length : 0;
  }

  // A few extra repeats over the same golden set for a less noisy p95.
  for (let i = 0; i < 3; i++) {
    for (const { question } of GOLDEN_SET) {
      const started = performance.now();
      await hybridSearch(fixture, question, K);
      latencies.push(performance.now() - started);
    }
  }

  latencies.sort((a, b) => a - b);
  const p95Index = Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1);

  return {
    'retrieval.hybridSearchP95Ms': {
      value: latencies[p95Index],
      unit: 'ms',
      direction: 'lower-is-better',
    },
    'retrieval.recallAt5': {
      value: recallSum / GOLDEN_SET.length,
      unit: 'ratio',
      direction: 'higher-is-better',
    },
    'retrieval.citationPrecisionAt5': {
      value: precisionSum / GOLDEN_SET.length,
      unit: 'ratio',
      direction: 'higher-is-better',
    },
  };
}
