import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import prettierConfig from 'eslint-config-prettier';

// Delivery surfaces: consumed by users, never by library packages (docs/02-architecture.md §2).
const SURFACES = ['@twograph/server', '@twograph/mcp', '@twograph/cli'];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      // Fixture app deliberately contains dead/imperfect code for the indexer to find.
      'examples/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.config.ts', 'scripts/*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': { typescript: true },
    },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/no-self-import': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    ignores: ['packages/server/**', 'packages/mcp/**', 'packages/cli/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: SURFACES.flatMap((s) => [s, `${s}/*`]),
              message:
                'Library packages must not import delivery surfaces (server/mcp/cli). See docs/02-architecture.md §2.',
            },
            {
              group: ['**/apps/*'],
              message: 'Packages must not import from apps.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettierConfig,
);
