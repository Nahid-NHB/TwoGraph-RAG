import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './scripts/vitest-aliases.ts';

// Integration tests only — require Memgraph/Qdrant from docker-compose.
export default defineConfig({
  resolve: { alias: workspaceAliases() },
  test: {
    include: ['packages/**/*.int.test.ts', 'apps/**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
