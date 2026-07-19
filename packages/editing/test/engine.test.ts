import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GraphQueries } from '@twograph/graph';
import { EditOperationRegistry, planEdit, type EditOperation } from '@twograph/editing';

let root: string;
let loadedPaths: string[] = [];

const bumpValueParams = z.object({ file: z.string(), from: z.string(), to: z.string() });

/** Toy operation for exercising the engine end-to-end — real operations land in later issues. */
const bumpValue: EditOperation<z.infer<typeof bumpValueParams>> = {
  id: 'bump_value',
  paramsSchema: bumpValueParams,
  entryPaths: (params) => [params.file],
  plan: (ctx, params) => {
    loadedPaths = ctx.project.getSourceFiles().map((f) => relative(ctx.rootPath, f.getFilePath()));
    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, params.file));
    sourceFile.replaceWithText(sourceFile.getFullText().replace(params.from, params.to));
    return { affectedSymbols: ['value'] };
  },
};

/** Toy operation that deliberately corrupts syntax, to exercise the post-transform check. */
const corrupt: EditOperation<{ file: string }> = {
  id: 'corrupt',
  paramsSchema: z.object({ file: z.string() }),
  entryPaths: (params) => [params.file],
  plan: (ctx, params) => {
    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, params.file));
    sourceFile.replaceWithText('export function broken( {');
    return { affectedSymbols: [] };
  },
};

/** Only `a.ts` has a graph-recorded dependent (`b.ts`) — `c.ts` is unrelated. */
function fakeGraphQueries(): GraphQueries {
  return {
    dependentFiles: (_repo: string, path: string) =>
      Promise.resolve(path === 'a.ts' ? ['b.ts'] : []),
  } as unknown as GraphQueries;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-editing-'));
  writeFileSync(join(root, 'a.ts'), 'export const value = 1;\n');
  writeFileSync(
    join(root, 'b.ts'),
    "import { value } from './a';\nexport const doubled = value * 2;\n",
  );
  writeFileSync(join(root, 'c.ts'), 'export const unrelated = true;\n');
  loadedPaths = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('planEdit', () => {
  it('loads a scoped project from graph-derived dependents, not the whole repo', async () => {
    const registry = new EditOperationRegistry();
    registry.register(bumpValue);

    await planEdit(
      registry,
      { repo: 't', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );

    expect(loadedPaths.sort()).toEqual(['a.ts', 'b.ts']);
    expect(loadedPaths).not.toContain('c.ts');
  });

  it('returns a diff preview matching the in-memory change, touching only the changed file', async () => {
    const registry = new EditOperationRegistry();
    registry.register(bumpValue);

    const plan = await planEdit(
      registry,
      { repo: 't', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );

    expect(plan.operation).toBe('bump_value');
    expect(plan.affectedFiles).toEqual(['a.ts']);
    expect(plan.affectedSymbols).toEqual(['value']);
    expect(plan.fileContents['a.ts']).toBe('export const value = 42;\n');
    expect(plan.diff).toContain('-export const value = 1;');
    expect(plan.diff).toContain('+export const value = 42;');
  });

  it('rejects an operation whose transform produces broken syntax', async () => {
    const registry = new EditOperationRegistry();
    registry.register(corrupt);

    await expect(
      planEdit(
        registry,
        { repo: 't', rootPath: root, graphQueries: fakeGraphQueries() },
        'corrupt',
        { file: 'a.ts' },
      ),
    ).rejects.toThrow(/invalid syntax/);
  });

  it('rejects params that fail the operation schema', async () => {
    const registry = new EditOperationRegistry();
    registry.register(bumpValue);

    await expect(
      planEdit(
        registry,
        { repo: 't', rootPath: root, graphQueries: fakeGraphQueries() },
        'bump_value',
        { file: 'a.ts' }, // missing from/to
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown operation id', async () => {
    const registry = new EditOperationRegistry();
    await expect(
      planEdit(
        registry,
        { repo: 't', rootPath: root, graphQueries: fakeGraphQueries() },
        'does_not_exist',
        {},
      ),
    ).rejects.toThrow(/unknown edit operation/);
  });
});
