import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './scripts/vitest-aliases.ts';

// Unit tests: `*.test.ts` — fast, no external services.
// Integration tests: `*.int.test.ts` — need the docker stack; run via `pnpm test:int`.
export default defineConfig({
  resolve: { alias: workspaceAliases() },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**'],
    },
  },
});
