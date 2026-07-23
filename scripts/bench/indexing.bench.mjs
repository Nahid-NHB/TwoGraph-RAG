// Indexing throughput (NFR-1) and incremental-update latency (NFR-2).
// Both are measured up to the first 'embed' progress tick — embedding itself
// is excluded per the NFR wording ("excl. embedding" / graph-updated cutoff).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeIndexer } from './lib/setup.mjs';

const TRIALS = 3;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

async function timeFullRebuild(fixture) {
  let discoverStart = 0;
  let embedStart = 0;
  let parsedTotal = 0;
  const indexer = makeIndexer(fixture, (p) => {
    if (p.stage === 'discover' && discoverStart === 0) discoverStart = performance.now();
    if (p.stage === 'parse') parsedTotal = p.total;
    if (p.stage === 'embed' && embedStart === 0) embedStart = performance.now();
  });
  await indexer.run({ rebuild: true, kind: 'full' });
  const parseExtractMs = embedStart - discoverStart;
  return parsedTotal / (parseExtractMs / 1000);
}

async function timeIncrementalUpdate(fixture) {
  // A real content change to one file, timed from discover to "graph
  // updated" (first embed tick) — mirrors "file save -> graph updated".
  const target = join(fixture.root, 'utils/format.ts');
  const original = readFileSync(target, 'utf8');
  writeFileSync(target, `${original}\nexport const BENCH_MARKER = ${String(Date.now())};\n`);

  let incStart = 0;
  let incEmbedStart = 0;
  const indexer = makeIndexer(fixture, (p) => {
    if (p.stage === 'discover' && incStart === 0) incStart = performance.now();
    if (p.stage === 'embed' && incEmbedStart === 0) incEmbedStart = performance.now();
  });
  await indexer.run({ kind: 'incremental' });
  writeFileSync(target, original);
  return incEmbedStart - incStart;
}

export async function runIndexingBench(fixture) {
  const throughputs = [];
  const incrementalLatencies = [];
  for (let i = 0; i < TRIALS; i++) {
    throughputs.push(await timeFullRebuild(fixture));
    incrementalLatencies.push(await timeIncrementalUpdate(fixture));
  }
  const throughputFilesPerSec = median(throughputs);
  const incrementalLatencyMs = median(incrementalLatencies);

  return {
    'indexing.throughputFilesPerSec': {
      value: throughputFilesPerSec,
      unit: 'files/s',
      direction: 'higher-is-better',
    },
    'indexing.incrementalLatencyMs': {
      value: incrementalLatencyMs,
      unit: 'ms',
      direction: 'lower-is-better',
    },
  };
}
