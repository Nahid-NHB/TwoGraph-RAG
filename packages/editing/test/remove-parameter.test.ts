import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatSymbolId } from '@twograph/core';
import type { GraphQueries } from '@twograph/graph';
import { EditOperationRegistry, planEdit, removeParameter } from '@twograph/editing';

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
  registry.register(removeParameter);
  return registry;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-remove-param-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('remove_parameter', () => {
  it('removes an unused parameter and prunes the argument at every call site', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function signToken(sub: string, unused: number): string {\n  return sub;\n}\n',
    );
    writeFileSync(
      join(root, 'handlers.ts'),
      "import { signToken } from './jwt';\nexport function issue(sub: string) {\n  return signToken(sub, 1);\n}\n",
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries({ 'jwt.ts': ['handlers.ts'] }) },
      'remove_parameter',
      { symbolId: symbolId('jwt.ts', 'signToken'), paramName: 'unused' },
    );

    expect(plan.fileContents['jwt.ts']).toContain(
      'export function signToken(sub: string): string {',
    );
    expect(plan.fileContents['handlers.ts']).toContain('return signToken(sub);');
  });

  it('rejects removing a parameter referenced in the function body', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function signToken(sub: string, ttl: number): string {\n  return sub + ttl;\n}\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'remove_parameter',
        { symbolId: symbolId('jwt.ts', 'signToken'), paramName: 'ttl' },
      ),
    ).rejects.toThrow(/used in the function body/);
  });

  it('allows removing a used parameter when force is set', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function signToken(sub: string, ttl: number): string {\n  return sub + ttl;\n}\n',
    );

    const plan = await planEdit(
      newRegistry(),
      { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
      'remove_parameter',
      { symbolId: symbolId('jwt.ts', 'signToken'), paramName: 'ttl', force: true },
    );

    expect(plan.fileContents['jwt.ts']).toContain(
      'export function signToken(sub: string): string {',
    );
    expect(plan.fileContents['jwt.ts']).toContain('return sub + ttl;'); // body left as-is, now a dangling reference
  });

  it('rejects removing an unknown parameter', async () => {
    writeFileSync(
      join(root, 'jwt.ts'),
      'export function signToken(sub: string): string {\n  return sub;\n}\n',
    );

    await expect(
      planEdit(
        newRegistry(),
        { repo: REPO, rootPath: root, graphQueries: fakeGraphQueries() },
        'remove_parameter',
        { symbolId: symbolId('jwt.ts', 'signToken'), paramName: 'doesNotExist' },
      ),
    ).rejects.toThrow(/no parameter named/);
  });
});
