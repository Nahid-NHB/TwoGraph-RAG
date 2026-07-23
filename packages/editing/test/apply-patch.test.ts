import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphQueries } from '@twograph/graph';
import { applyPatch, EditOperationRegistry, planEdit } from '@twograph/editing';

let root: string;
const REPO = 'r';

function fakeGraphQueries(): GraphQueries {
  return { dependentFiles: () => Promise.resolve([]) } as unknown as GraphQueries;
}

function newRegistry(): EditOperationRegistry {
  const registry = new EditOperationRegistry();
  registry.register(applyPatch);
  return registry;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-apply-patch-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('apply_patch', () => {
  it('replaces an inclusive line range with new text', async () => {
    writeFileSync(
      join(root, 'list.tsx'),
      [
        'export function List({ items }: { items: string[] }) {',
        '  return items.map((item) => <li>{item}</li>);',
        '}',
        '',
      ].join('\n'),
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'apply_patch',
      {
        file: 'list.tsx',
        startLine: 2,
        endLine: 2,
        newText: '  return items.map((item) => <li key={item}>{item}</li>);',
      },
    );

    expect(plan.affectedFiles).toEqual(['list.tsx']);
    expect(plan.fileContents['list.tsx']).toContain('<li key={item}>{item}</li>');
    expect(plan.diff).toContain('-  return items.map((item) => <li>{item}</li>);');
    expect(plan.diff).toContain('+  return items.map((item) => <li key={item}>{item}</li>);');
  });

  it('can replace a range with multiple lines', async () => {
    writeFileSync(join(root, 'a.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'apply_patch',
      { file: 'a.ts', startLine: 2, endLine: 2, newText: 'const b = 2;\nconst bb = 22;' },
    );

    expect(plan.fileContents['a.ts']).toBe(
      'const a = 1;\nconst b = 2;\nconst bb = 22;\nconst c = 3;\n',
    );
  });

  it('rejects an endLine past the end of the file', async () => {
    writeFileSync(join(root, 'a.ts'), 'const a = 1;\n');

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'apply_patch',
        { file: 'a.ts', startLine: 1, endLine: 5, newText: 'x' },
      ),
    ).rejects.toThrow(/past the end of the file/);
  });

  it('rejects endLine before startLine', async () => {
    writeFileSync(join(root, 'a.ts'), 'const a = 1;\nconst b = 2;\n');

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'apply_patch',
        { file: 'a.ts', startLine: 2, endLine: 1, newText: 'x' },
      ),
    ).rejects.toThrow(/endLine must be/);
  });
});
