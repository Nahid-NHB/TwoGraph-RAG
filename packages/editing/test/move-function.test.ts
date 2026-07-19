import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatSymbolId } from '@twograph/core';
import type { GraphQueries } from '@twograph/graph';
import { EditOperationRegistry, moveFunction, planEdit } from '@twograph/editing';

let root: string;
const REPO = 'r';

function symbolId(path: string, name: string): string {
  return formatSymbolId({ repo: REPO, path, qualifiedName: name });
}

function fakeGraphQueries(dependents: Record<string, string[]> = {}): GraphQueries {
  return {
    dependentFiles: (_repo: string, path: string) => Promise.resolve(dependents[path] ?? []),
  } as unknown as GraphQueries;
}

function newRegistry(): EditOperationRegistry {
  const registry = new EditOperationRegistry();
  registry.register(moveFunction);
  return registry;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-move-fn-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('move_function', () => {
  it('moves a self-contained function into a brand-new target file', async () => {
    writeFileSync(
      join(root, 'utils.ts'),
      'export function double(x: number): number {\n  return x * 2;\n}\n',
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'move_function',
      { symbolId: symbolId('utils.ts', 'double'), targetFile: 'math.ts' },
    );

    expect(plan.affectedFiles.sort()).toEqual(['math.ts', 'utils.ts']);
    expect(plan.fileContents['utils.ts']?.trim()).toBe('');
    expect(plan.fileContents['math.ts']).toContain('export function double(x: number): number');
  });

  it('recalculates an import the moved function depends on', async () => {
    writeFileSync(join(root, 'types.ts'), 'export interface Money {\n  cents: number;\n}\n');
    writeFileSync(
      join(root, 'utils.ts'),
      "import type { Money } from './types';\nexport function toDollars(m: Money): number {\n  return m.cents / 100;\n}\n",
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'move_function',
      { symbolId: symbolId('utils.ts', 'toDollars'), targetFile: 'nested/money.ts' },
    );

    expect(plan.fileContents['nested/money.ts']).toContain(
      "import type { Money } from '../types';",
    );
    expect(plan.fileContents['nested/money.ts']).toContain(
      'export function toDollars(m: Money): number',
    );
    // The source file no longer uses Money, so its import should be pruned.
    expect(plan.fileContents['utils.ts']).not.toContain('Money');
  });

  it('imports a sibling declaration that remains behind, when it is exported', async () => {
    writeFileSync(
      join(root, 'utils.ts'),
      'export const TAX_RATE = 0.2;\nexport function withTax(amount: number): number {\n  return amount * (1 + TAX_RATE);\n}\n',
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'move_function',
      { symbolId: symbolId('utils.ts', 'withTax'), targetFile: 'pricing.ts' },
    );

    expect(plan.fileContents['pricing.ts']).toContain("import { TAX_RATE } from './utils';");
    expect(plan.fileContents['pricing.ts']).toContain(
      'export function withTax(amount: number): number',
    );
    expect(plan.fileContents['utils.ts']).toContain('export const TAX_RATE = 0.2;');
  });

  it('rejects moving a function that depends on a non-exported sibling', async () => {
    writeFileSync(
      join(root, 'utils.ts'),
      'const secret = 42;\nexport function reveal(): number {\n  return secret;\n}\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'move_function',
        { symbolId: symbolId('utils.ts', 'reveal'), targetFile: 'other.ts' },
      ),
    ).rejects.toThrow(/not exported/);
  });

  it('re-points every importer to the new location', async () => {
    writeFileSync(
      join(root, 'utils.ts'),
      'export function double(x: number): number {\n  return x * 2;\n}\n',
    );
    writeFileSync(
      join(root, 'consumer.ts'),
      "import { double } from './utils';\nexport function run() {\n  return double(21);\n}\n",
    );

    const plan = await planEdit(
      newRegistry(),
      {
        repo: REPO,
        rootPath: root,
        graphQueries: fakeGraphQueries({ 'utils.ts': ['consumer.ts'] }),
      },
      'move_function',
      { symbolId: symbolId('utils.ts', 'double'), targetFile: 'math.ts' },
    );

    expect(plan.fileContents['consumer.ts']).toContain("import { double } from './math';");
    expect(plan.fileContents['consumer.ts']).not.toContain("from './utils'");
  });

  it('re-points a barrel re-export to the new location', async () => {
    writeFileSync(
      join(root, 'utils.ts'),
      'export function double(x: number): number {\n  return x * 2;\n}\n',
    );
    writeFileSync(join(root, 'index.ts'), "export { double } from './utils';\n");

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries({ 'utils.ts': ['index.ts'] }) },
      'move_function',
      { symbolId: symbolId('utils.ts', 'double'), targetFile: 'math.ts' },
    );

    expect(plan.fileContents['index.ts']).toContain("export { double } from './math';");
  });

  it('rejects moving into a file where the name is already declared', async () => {
    writeFileSync(
      join(root, 'utils.ts'),
      'export function double(x: number): number {\n  return x * 2;\n}\n',
    );
    writeFileSync(
      join(root, 'math.ts'),
      'export function double(x: string): string {\n  return x + x;\n}\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'move_function',
        { symbolId: symbolId('utils.ts', 'double'), targetFile: 'math.ts' },
      ),
    ).rejects.toThrow(/already declared/);
  });
});
