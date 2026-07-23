#!/usr/bin/env node
// Benchmark suite (issue #70): indexing throughput/latency + retrieval
// quality/latency against examples/sample-repo, written as a comparable JSON
// report and gated against a committed baseline. Requires the workspace to
// be built (`pnpm build`) and the docker-compose stack running.
//
//   pnpm bench                  # run + gate against scripts/bench/baseline.json
//   pnpm bench --update-baseline  # run + overwrite the committed baseline
import { setupBenchFixture } from './lib/setup.mjs';
import { runCachingBench } from './caching.bench.mjs';
import { runIndexingBench } from './indexing.bench.mjs';
import { runRetrievalBench } from './retrieval.bench.mjs';
import {
  compareToBaseline,
  loadBaseline,
  writeBaseline,
  writeLatestResult,
} from './lib/report.mjs';

const updateBaseline = process.argv.includes('--update-baseline');

function formatRow(row) {
  const value = `${row.value.toFixed(2)} ${row.unit}`;
  if (row.pctChange === null) return `  ${row.key}: ${value}  (no baseline)`;
  const pct = `${(row.pctChange * 100).toFixed(1)}%`;
  const flag = row.regressed ? ' — REGRESSION' : '';
  return `  ${row.key}: ${value}  ${pct} vs baseline${flag}`;
}

const fixture = await setupBenchFixture();
try {
  const metrics = {
    ...(await runIndexingBench(fixture)),
    ...(await runRetrievalBench(fixture)),
    ...(await runCachingBench(fixture)),
  };
  const report = { timestamp: new Date().toISOString(), metrics };
  writeLatestResult(report);

  const baseline = loadBaseline();
  const { rows, anyRegression } = compareToBaseline(report, baseline);

  console.log('\nBenchmark results:\n');
  for (const row of rows) console.log(formatRow(row));

  if (updateBaseline) {
    writeBaseline(report);
    console.log('\nWrote new baseline to scripts/bench/baseline.json');
  } else if (!baseline) {
    console.log('\nNo baseline recorded yet — run with --update-baseline to record one.');
  } else if (anyRegression) {
    console.error(`\nBenchmark regression >${String(20)}% detected vs baseline — failing.`);
    process.exitCode = 1;
  } else {
    console.log('\nNo regressions vs baseline.');
  }
} finally {
  await fixture.cleanup();
}
