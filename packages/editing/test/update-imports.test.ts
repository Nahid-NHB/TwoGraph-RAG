import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphQueries } from '@twograph/graph';
import { EditOperationRegistry, planEdit, updateImports } from '@twograph/editing';

let root: string;
const REPO = 'r';

function fakeGraphQueries(): GraphQueries {
  return { dependentFiles: () => Promise.resolve([]) } as unknown as GraphQueries;
}

function newRegistry(): EditOperationRegistry {
  const registry = new EditOperationRegistry();
  registry.register(updateImports);
  return registry;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-update-imports-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('update_imports — add', () => {
  it('creates a new import statement when none exists for the module', async () => {
    writeFileSync(join(root, 'a.ts'), 'export const x = 1;\n');

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'update_imports',
      { file: 'a.ts', add: [{ moduleSpecifier: './b', namedImports: ['thing'] }] },
    );

    expect(plan.fileContents['a.ts']).toContain("import { thing } from './b';");
  });

  it('dedupes into an existing import from the same module rather than duplicating the statement', async () => {
    writeFileSync(join(root, 'a.ts'), "import { thing } from './b';\nexport const x = thing;\n");

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'update_imports',
      { file: 'a.ts', add: [{ moduleSpecifier: './b', namedImports: ['other'] }] },
    );

    const content = plan.fileContents['a.ts']!;
    expect(content).toContain("import { thing, other } from './b';");
    expect(content.match(/from '\.\/b'/g)).toHaveLength(1);
  });
});

describe('update_imports — remove', () => {
  it('removes just the named specifier, keeping the rest of the statement', async () => {
    writeFileSync(join(root, 'a.ts'), "import { a, b } from './mod';\nexport const x = a;\n");

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'update_imports',
      { file: 'a.ts', remove: [{ moduleSpecifier: './mod', namedImports: ['b'] }] },
    );

    const content = plan.fileContents['a.ts']!;
    expect(content).toContain("import { a } from './mod';");
    expect(content).not.toContain('b');
  });

  it('removes the whole statement once its last named specifier is gone', async () => {
    writeFileSync(join(root, 'a.ts'), "import { a } from './mod';\nexport const x = 1;\n");

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'update_imports',
      { file: 'a.ts', remove: [{ moduleSpecifier: './mod', namedImports: ['a'] }] },
    );

    expect(plan.fileContents['a.ts']).not.toContain('./mod');
  });

  it('removes a whole statement by module specifier alone', async () => {
    writeFileSync(join(root, 'a.ts'), "import { a, b } from './mod';\nexport const x = 1;\n");

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'update_imports',
      { file: 'a.ts', remove: [{ moduleSpecifier: './mod' }] },
    );

    expect(plan.fileContents['a.ts']).not.toContain('./mod');
  });

  it('is a no-op when the module specifier is not imported', async () => {
    writeFileSync(join(root, 'a.ts'), 'export const x = 1;\n');

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'update_imports',
      { file: 'a.ts', remove: [{ moduleSpecifier: './nope' }] },
    );

    expect(plan.affectedFiles).toEqual([]);
  });
});

describe('update_imports — organize', () => {
  it('sorts and merges duplicate module specifiers', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      "import { b } from './b';\nimport { a } from './a';\nimport { c } from './a';\nexport const x = a + b + c;\n",
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'update_imports',
      { file: 'a.ts', organize: true },
    );

    const content = plan.fileContents['a.ts']!;
    expect(content.match(/from '\.\/a'/g)).toHaveLength(1);
    expect(content.indexOf("from './a'")).toBeLessThan(content.indexOf("from './b'"));
  });

  it('drops an import left unused, but never a side-effect-only import', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      "import './side-effect';\nimport { unused } from './b';\nexport const x = 1;\n",
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'update_imports',
      { file: 'a.ts', organize: true },
    );

    const content = plan.fileContents['a.ts']!;
    expect(content).toContain("import './side-effect';");
    expect(content).not.toContain('unused');
  });

  it('is idempotent — organizing already-organized imports produces no further diff', async () => {
    writeFileSync(
      join(root, 'a.ts'),
      "import { b } from './b';\nimport { a } from './a';\nexport const x = a + b;\n",
    );

    const registry = newRegistry();
    const deps = { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() };
    const first = await planEdit(registry, deps, 'update_imports', {
      file: 'a.ts',
      organize: true,
    });
    expect(first.fileContents['a.ts']).toBeDefined();
    writeFileSync(join(root, 'a.ts'), first.fileContents['a.ts']!);

    const second = await planEdit(registry, deps, 'update_imports', {
      file: 'a.ts',
      organize: true,
    });
    expect(second.affectedFiles).toEqual([]);
  });
});
