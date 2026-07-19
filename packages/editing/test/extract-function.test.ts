import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphQueries } from '@twograph/graph';
import { EditOperationRegistry, extractFunction, planEdit } from '@twograph/editing';

let root: string;
const REPO = 'r';

function fakeGraphQueries(): GraphQueries {
  return { dependentFiles: () => Promise.resolve([]) } as unknown as GraphQueries;
}

function newRegistry(): EditOperationRegistry {
  const registry = new EditOperationRegistry();
  registry.register(extractFunction);
  return registry;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-extract-fn-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('extract_function', () => {
  it('extracts a self-contained span with no captured variables and no return', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      ['function run(): void {', '  console.log("start");', '  console.log("end");', '}', ''].join(
        '\n',
      ),
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'extract_function',
      { file: 'a.ts', startLine: 2, endLine: 3, name: 'logBoth' },
    );

    expect(plan.fileContents['a.ts']).toContain('function logBoth(): void {');
    expect(plan.fileContents['a.ts']).toContain('console.log("start");');
    expect(plan.fileContents['a.ts']).toContain('logBoth();');
  });

  it('captures external variables as parameters', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      [
        'function run(a: number, b: number): number {',
        '  const sum = a + b;',
        '  return sum;',
        '}',
        '',
      ].join('\n'),
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'extract_function',
      { file: 'a.ts', startLine: 2, endLine: 2, name: 'addThem' },
    );

    expect(plan.fileContents['a.ts']).toContain('function addThem(a: number, b: number)');
    expect(plan.fileContents['a.ts']).toContain('const sum = addThem(a, b);');
  });

  it('returns a variable declared in the span and read afterward', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      [
        'function run(a: number, b: number): number {',
        '  const sum = a + b;',
        '  return sum + 1;',
        '}',
        '',
      ].join('\n'),
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'extract_function',
      { file: 'a.ts', startLine: 2, endLine: 2, name: 'addThem' },
    );

    expect(plan.fileContents['a.ts']).toContain('function addThem(a: number, b: number): number {');
    expect(plan.fileContents['a.ts']).toContain('return sum;');
    expect(plan.fileContents['a.ts']).toContain('const sum = addThem(a, b);');
  });

  it('reassigns (not re-declares) a pre-existing variable mutated in the span and read afterward', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      [
        'function run(a: number): number {',
        '  let total = 0;',
        '  total = total + a;',
        '  return total;',
        '}',
        '',
      ].join('\n'),
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'extract_function',
      { file: 'a.ts', startLine: 3, endLine: 3, name: 'accumulate' },
    );

    expect(plan.fileContents['a.ts']).toContain('total = accumulate(total, a);');
    expect(plan.fileContents['a.ts']).not.toContain('const total =');
  });

  it('returns multiple variables as an object when more than one output is needed', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      [
        'function run(a: number, b: number): number {',
        '  const sum = a + b;',
        '  const product = a * b;',
        '  return sum + product;',
        '}',
        '',
      ].join('\n'),
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'extract_function',
      { file: 'a.ts', startLine: 2, endLine: 3, name: 'compute' },
    );

    expect(plan.fileContents['a.ts']).toContain('return { sum, product };');
    expect(plan.fileContents['a.ts']).toContain('const { sum, product } = compute(a, b);');
  });

  it('rejects a span containing a return statement', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      ['function run(a: number): number {', '  if (a < 0) return -1;', '  return a;', '}', ''].join(
        '\n',
      ),
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'extract_function',
        { file: 'a.ts', startLine: 2, endLine: 2, name: 'guard' },
      ),
    ).rejects.toThrow(/ReturnStatement/);
  });

  it('rejects a span containing a break inside a loop', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      [
        'function run(items: number[]): number {',
        '  let found = 0;',
        '  for (const item of items) {',
        '    if (item === 0) break;',
        '    found = item;',
        '  }',
        '  return found;',
        '}',
        '',
      ].join('\n'),
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'extract_function',
        { file: 'a.ts', startLine: 3, endLine: 6, name: 'scan' },
      ),
    ).rejects.toThrow(/BreakStatement/);
  });

  it('rejects an empty/invalid line range', async () => {
    writeFileSync(join(root, 'a.ts'), 'function run(): void {\n  console.log("x");\n}\n');

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'extract_function',
        { file: 'a.ts', startLine: 1, endLine: 1, name: 'nothing' },
      ),
    ).rejects.toThrow(/no statements found/);
  });

  it('rejects extracting into a name already declared at the top level', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      'function helper(): void {}\nfunction run(): void {\n  console.log("x");\n}\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'extract_function',
        { file: 'a.ts', startLine: 3, endLine: 3, name: 'helper' },
      ),
    ).rejects.toThrow(/already declared/);
  });
});
