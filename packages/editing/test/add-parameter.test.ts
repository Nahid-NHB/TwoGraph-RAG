import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatSymbolId } from '@twograph/core';
import type { GraphQueries } from '@twograph/graph';
import { addParameter, EditOperationRegistry, planEdit } from '@twograph/editing';

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
  registry.register(addParameter);
  return registry;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-add-param-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('add_parameter', () => {
  it('adds a defaulted parameter and appends it as an explicit arg at every call site', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function signToken(sub: string): string {\n  return sub;\n}\n',
    );
    writeFileSync(
      join(root, 'handlers.ts'),
      "import { signToken } from './jwt';\nexport function issue(sub: string) {\n  return signToken(sub);\n}\n",
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries({ 'jwt.ts': ['handlers.ts'] }) },
      'add_parameter',
      {
        symbolId: symbolId('jwt.ts', 'signToken'),
        name: 'ttlSeconds',
        type: 'number',
        defaultValue: '3600',
      },
    );

    expect(plan.fileContents['jwt.ts']).toContain(
      'export function signToken(sub: string, ttlSeconds: number = 3600): string {',
    );
    expect(plan.fileContents['handlers.ts']).toContain('return signToken(sub, 3600);');
  });

  it('adds an optional parameter without touching any call site when no default is given', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function signToken(sub: string): string {\n  return sub;\n}\n',
    );
    writeFileSync(
      join(root, 'handlers.ts'),
      "import { signToken } from './jwt';\nexport function issue(sub: string) {\n  return signToken(sub);\n}\n",
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries({ 'jwt.ts': ['handlers.ts'] }) },
      'add_parameter',
      { symbolId: symbolId('jwt.ts', 'signToken'), name: 'ttlSeconds', type: 'number' },
    );

    expect(plan.fileContents['jwt.ts']).toContain(
      'export function signToken(sub: string, ttlSeconds?: number): string {',
    );
    expect(plan.affectedFiles).toEqual(['jwt.ts']);
  });

  it('works on a const bound to an arrow function', async () => {
    writeFileSync(root + '/util.ts', 'export const add = (a: number, b: number) => a + b;\n');

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'add_parameter',
      { symbolId: symbolId('util.ts', 'add'), name: 'c', type: 'number', defaultValue: '0' },
    );

    expect(plan.fileContents['util.ts']).toContain('(a: number, b: number, c: number = 0)');
  });

  it('rejects editing an overloaded function signature', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function signToken(sub: string): string;\nexport function signToken(sub: string, ttl: number): string;\nexport function signToken(sub: string, ttl?: number): string {\n  return sub;\n}\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'add_parameter',
        {
          symbolId: symbolId('jwt.ts', 'signToken'),
          name: 'extra',
          type: 'boolean',
          defaultValue: 'false',
        },
      ),
    ).rejects.toThrow(/overload/);
  });

  it('rejects adding a parameter name that already exists', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function signToken(sub: string): string {\n  return sub;\n}\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'add_parameter',
        { symbolId: symbolId('jwt.ts', 'signToken'), name: 'sub', type: 'string' },
      ),
    ).rejects.toThrow(/already exists/);
  });
});
