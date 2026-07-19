import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphQueries } from '@twograph/graph';
import { EditOperationRegistry, extractFunction, planEdit } from '@twograph/editing';
import { ts } from 'ts-morph';

let root: string;
const REPO = 'r';

function fakeGraphQueries(): GraphQueries {
  return { dependentFiles: () => Promise.resolve([]) } as unknown as GraphQueries;
}

/** Transpiles TS source to a runnable ESM module and imports it — proves the extracted code actually executes. */
async function loadAsModule(text: string, dir: string): Promise<Record<string, unknown>> {
  const { outputText } = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const jsPath = join(dir, `out-${String(Date.now())}-${String(Math.random()).slice(2)}.mjs`);
  writeFileSync(jsPath, outputText);
  return import(pathToFileURL(jsPath).href) as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-extract-behavior-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('extract_function — executable behavior', () => {
  it('produces code that compiles and behaves identically to the original for a returned-value extraction', async () => {
    const original = [
      'export function total(items: number[], taxRate: number): number {',
      '  let sum = 0;',
      '  for (const item of items) {',
      '    sum = sum + item;',
      '  }',
      '  const withTax = sum * (1 + taxRate);',
      '  return withTax;',
      '}',
      '',
    ].join('\n');
    writeFileSync(join(root, 'a.ts'), original);

    const registry = new EditOperationRegistry();
    registry.register(extractFunction);
    const plan = await planEdit(
      registry,
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'extract_function',
      { file: 'a.ts', startLine: 3, endLine: 5, name: 'sumItems' },
    );

    const extracted = plan.fileContents['a.ts']!;
    expect(extracted).toContain('function sumItems(');

    const originalModule = (await loadAsModule(original, root)) as {
      total: (items: number[], taxRate: number) => number;
    };
    const extractedModule = (await loadAsModule(extracted, root)) as {
      total: (items: number[], taxRate: number) => number;
    };

    const cases: [number[], number][] = [
      [[1, 2, 3], 0.1],
      [[], 0.2],
      [[10, -5, 7], 0],
    ];
    for (const [items, taxRate] of cases) {
      expect(extractedModule.total(items, taxRate)).toBe(originalModule.total(items, taxRate));
    }
  });

  it('produces code that compiles and behaves identically for a no-return, side-effecting extraction', async () => {
    const original = [
      'export const log: string[] = [];',
      'export function record(a: number, b: number): void {',
      '  log.push(`sum=${a + b}`);',
      '  log.push(`product=${a * b}`);',
      '}',
      '',
    ].join('\n');
    writeFileSync(join(root, 'b.ts'), original);

    const registry = new EditOperationRegistry();
    registry.register(extractFunction);
    const plan = await planEdit(
      registry,
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'extract_function',
      { file: 'b.ts', startLine: 3, endLine: 4, name: 'recordBoth' },
    );

    const extracted = plan.fileContents['b.ts']!;
    expect(extracted).toContain('function recordBoth(');

    const originalModule = (await loadAsModule(original, root)) as {
      record: (a: number, b: number) => void;
      log: string[];
    };
    const extractedModule = (await loadAsModule(extracted, root)) as {
      record: (a: number, b: number) => void;
      log: string[];
    };

    originalModule.record(3, 4);
    extractedModule.record(3, 4);
    expect(extractedModule.log).toEqual(originalModule.log);
  });
});
