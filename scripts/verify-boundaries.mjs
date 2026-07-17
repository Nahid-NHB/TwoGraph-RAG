// Proves the ESLint package-boundary rule fires: drops a deliberate violation
// into a library package, lints it, and expects `no-restricted-imports` errors.
// Exits 0 iff the violation is caught. Run via `pnpm lint:boundaries`.
import { ESLint } from 'eslint';
import { writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(
  new URL('../packages/core/src/__boundary-violation.fixture__.ts', import.meta.url),
);

const violation = `import '@twograph/server';\nimport '@twograph/cli';\n`;

try {
  await writeFile(fixture, violation);
  const eslint = new ESLint();
  const [result] = await eslint.lintFiles([fixture]);
  const hits = (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
  if (hits.length < 2) {
    console.error(
      `FAIL: expected 2 no-restricted-imports errors, got ${hits.length}.\n` +
        JSON.stringify(result?.messages ?? [], null, 2),
    );
    process.exit(1);
  }
  console.log(`OK: boundary rule caught ${hits.length}/2 surface imports in a library package.`);
} finally {
  await rm(fixture, { force: true });
}
