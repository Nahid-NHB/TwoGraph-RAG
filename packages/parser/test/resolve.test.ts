import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParsedFile } from '@twograph/core';
import { ParserEngine, resolveReferences } from '@twograph/parser';

const engine = new ParserEngine();
const ROOT = join(import.meta.dirname, '../../../examples/sample-repo/src');

async function parseSampleRepo(): Promise<ParsedFile[]> {
  const files: ParsedFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) await walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        files.push(
          await engine.parseFile('sample', relative(ROOT, full), readFileSync(full, 'utf8')),
        );
      }
    }
  };
  await walk(ROOT);
  return files;
}

describe('resolveReferences over sample-repo', () => {
  let files: ParsedFile[];
  beforeAll(async () => {
    files = await parseSampleRepo();
    resolveReferences(files);
  });

  const refsOf = (path: string) => files.find((f) => f.path === path)?.references ?? [];

  it('resolves imported calls across files', () => {
    expect(refsOf('api/users.ts')).toContainEqual(
      expect.objectContaining({
        from: 'fetchUser',
        name: 'fetchJson',
        resolvedId: 'sample:api/client.ts#fetchJson',
      }),
    );
  });

  it('resolves through barrel star re-exports', () => {
    expect(refsOf('components/UserCard.tsx')).toContainEqual(
      expect.objectContaining({
        name: 'formatName',
        resolvedId: 'sample:utils/format.ts#formatName',
      }),
    );
  });

  it('resolves JSX component usage', () => {
    expect(refsOf('components/UserList.tsx')).toContainEqual(
      expect.objectContaining({
        from: 'UserList',
        name: 'UserCard',
        kind: 'jsx',
        resolvedId: 'sample:components/UserCard.tsx#UserCard',
      }),
    );
  });

  it('resolves file-local calls and heritage', () => {
    expect(refsOf('auth/jwt.ts')).toContainEqual(
      expect.objectContaining({
        name: 'decodeToken',
        resolvedId: 'sample:auth/jwt.ts#decodeToken',
      }),
    );
    expect(refsOf('auth/authService.ts')).toContainEqual(
      expect.objectContaining({
        from: 'AuthService',
        kind: 'extends',
        resolvedId: 'sample:auth/authService.ts#BaseService',
      }),
    );
  });

  it('resolves implements against imported interface types', () => {
    expect(refsOf('auth/authService.ts')).toContainEqual(
      expect.objectContaining({
        kind: 'implements',
        resolvedId: 'sample:auth/types.ts#IAuthService',
      }),
    );
  });

  it('leaves package references external (no resolvedId)', () => {
    const axiosRef = refsOf('api/client.ts').find((r) => r.name === 'axios.request');
    expect(axiosRef?.resolvedId).toBeUndefined();
  });

  it('resolves hook usage across files', () => {
    expect(refsOf('components/UserList.tsx')).toContainEqual(
      expect.objectContaining({
        name: 'useUsers',
        kind: 'hook',
        resolvedId: 'sample:hooks/useUsers.ts#useUsers',
      }),
    );
  });
});

describe('tsconfig path aliases', () => {
  it('resolves @/ style aliases', async () => {
    const a = await engine.parseFile(
      't',
      'src/feature/a.ts',
      "import { util } from '@/lib/util';\nexport const run = () => util();",
    );
    const b = await engine.parseFile(
      't',
      'src/lib/util.ts',
      'export function util() { return 1; }',
    );
    const stats = resolveReferences([a, b], { paths: { '@/*': ['src/*'] } });
    expect(a.references).toContainEqual(
      expect.objectContaining({ name: 'util', resolvedId: 't:src/lib/util.ts#util' }),
    );
    expect(stats.resolved).toBeGreaterThan(0);
  });
});
