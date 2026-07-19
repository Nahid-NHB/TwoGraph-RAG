import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatSymbolId } from '@twograph/core';
import type { GraphQueries } from '@twograph/graph';
import { EditOperationRegistry, planEdit, renameSymbol } from '@twograph/editing';

let root: string;
const REPO = 'r';

function symbolId(path: string, name: string): string {
  return formatSymbolId({ repo: REPO, path, qualifiedName: name });
}

/** `dependents` maps a repo-relative path to the paths that import/export it. */
function fakeGraphQueries(dependents: Record<string, string[]>): GraphQueries {
  return {
    dependentFiles: (_repo: string, path: string) => Promise.resolve(dependents[path] ?? []),
  } as unknown as GraphQueries;
}

function newRegistry(): EditOperationRegistry {
  const registry = new EditOperationRegistry();
  registry.register(renameSymbol);
  return registry;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-rename-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('rename_symbol', () => {
  it('renames a function declaration and its call sites across files', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function verifyToken(t: string): boolean {\n  return t.length > 0;\n}\n',
    );
    writeFileSync(
      join(root, 'handlers.ts'),
      "import { verifyToken } from './jwt';\nexport function handle(t: string) {\n  return verifyToken(t);\n}\n",
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries({ 'jwt.ts': ['handlers.ts'] }) },
      'rename_symbol',
      { symbolId: symbolId('jwt.ts', 'verifyToken'), newName: 'verifyJwt' },
    );

    expect(plan.affectedFiles.sort()).toEqual(['handlers.ts', 'jwt.ts']);
    expect(plan.fileContents['jwt.ts']).toContain('export function verifyJwt(');
    expect(plan.fileContents['handlers.ts']).toContain("import { verifyJwt } from './jwt';");
    expect(plan.fileContents['handlers.ts']).toContain('return verifyJwt(t);');
  });

  it('renames a React component across its JSX usage and a named barrel re-export', async () => {
    writeFileSync(
      join(root, 'UserCard.tsx'),
      'export function UserCard({ name }: { name: string }) {\n  return <span>{name}</span>;\n}\n',
    );
    writeFileSync(
      join(root, 'UserList.tsx'),
      'import { UserCard } from \'./UserCard\';\nexport function UserList() {\n  return <UserCard name="a" />;\n}\n',
    );
    writeFileSync(join(root, 'index.ts'), "export { UserCard } from './UserCard';\n");

    const plan = await planEdit(
      newRegistry(),
      {
        repo: REPO,
        rootPath: root,
        graphQueries: fakeGraphQueries({
          'UserCard.tsx': ['UserList.tsx', 'index.ts'],
        }),
      },
      'rename_symbol',
      { symbolId: symbolId('UserCard.tsx', 'UserCard'), newName: 'UserProfileCard' },
    );

    expect(plan.affectedFiles.sort()).toEqual(['UserCard.tsx', 'UserList.tsx', 'index.ts'].sort());
    expect(plan.fileContents['UserCard.tsx']).toContain('export function UserProfileCard(');
    expect(plan.fileContents['UserList.tsx']).toContain('<UserProfileCard name="a" />');
    expect(plan.fileContents['UserList.tsx']).toContain(
      "import { UserProfileCard } from './UserCard';",
    );
    expect(plan.fileContents['index.ts']).toContain(
      "export { UserProfileCard } from './UserCard';",
    );
  });

  it('leaves string-literal occurrences of the old name untouched', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function verifyToken(t: string): boolean {\n  console.log("verifyToken called");\n  return t.length > 0;\n}\n',
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries({}) },
      'rename_symbol',
      { symbolId: symbolId('jwt.ts', 'verifyToken'), newName: 'verifyJwt' },
    );

    expect(plan.fileContents['jwt.ts']).toContain('export function verifyJwt(');
    expect(plan.fileContents['jwt.ts']).toContain('console.log("verifyToken called");');
  });

  it('rejects renaming into a name already bound at the top level of the file', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function verifyToken(t: string): boolean {\n  return t.length > 0;\n}\nexport function verifyJwt(t: string): boolean {\n  return true;\n}\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries({}) },
        'rename_symbol',
        { symbolId: symbolId('jwt.ts', 'verifyToken'), newName: 'verifyJwt' },
      ),
    ).rejects.toThrow(/already declared/);
  });

  it('rejects a newName that is not a valid identifier', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function verifyToken(t: string) { return true; }\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries({}) },
        'rename_symbol',
        { symbolId: symbolId('jwt.ts', 'verifyToken'), newName: '123-not-valid' },
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown symbol name', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function verifyToken(t: string) { return true; }\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries({}) },
        'rename_symbol',
        { symbolId: symbolId('jwt.ts', 'doesNotExist'), newName: 'whatever' },
      ),
    ).rejects.toThrow(/no top-level function, const, or class/);
  });
});
