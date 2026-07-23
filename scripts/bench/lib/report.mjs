import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REGRESSION_THRESHOLD = 0.2;

const BASELINE_PATH = fileURLToPath(new URL('../baseline.json', import.meta.url));
const RESULTS_PATH = fileURLToPath(new URL('../results/latest.json', import.meta.url));

export function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

export function writeBaseline(report) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

export function writeLatestResult(report) {
  mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
  writeFileSync(RESULTS_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

/**
 * Per-metric % change vs baseline, sign-adjusted so a positive value always
 * means "worse" regardless of the metric's direction. Flags a regression
 * when that adjusted change exceeds {@link REGRESSION_THRESHOLD}.
 */
export function compareToBaseline(current, baseline) {
  const rows = [];
  let anyRegression = false;
  for (const [key, metric] of Object.entries(current.metrics)) {
    const base = baseline?.metrics?.[key];
    if (!base) {
      rows.push({ key, ...metric, baselineValue: null, pctChange: null, regressed: false });
      continue;
    }
    const pctChange =
      metric.direction === 'higher-is-better'
        ? (base.value - metric.value) / base.value
        : (metric.value - base.value) / base.value;
    const regressed = pctChange > REGRESSION_THRESHOLD;
    if (regressed) anyRegression = true;
    rows.push({ key, ...metric, baselineValue: base.value, pctChange, regressed });
  }
  return { rows, anyRegression };
}
