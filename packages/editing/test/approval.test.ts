import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GraphQueries } from '@twograph/graph';
import { MetadataStore, openDatabase } from '@twograph/store';
import {
  approveEdit,
  EditOperationRegistry,
  proposeEdit,
  rejectEdit,
  revertEdit,
  type EditOperation,
} from '@twograph/editing';

let root: string;
let store: MetadataStore;

const bumpValueParams = z.object({ file: z.string(), from: z.string(), to: z.string() });

const bumpValue: EditOperation<z.infer<typeof bumpValueParams>> = {
  id: 'bump_value',
  paramsSchema: bumpValueParams,
  entryPaths: (params) => [params.file],
  plan: (ctx, params) => {
    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, params.file));
    sourceFile.replaceWithText(sourceFile.getFullText().replace(params.from, params.to));
    return { affectedSymbols: ['value'] };
  },
};

function fakeGraphQueries(): GraphQueries {
  return { dependentFiles: () => Promise.resolve([]) } as unknown as GraphQueries;
}

function newRegistry(): EditOperationRegistry {
  const registry = new EditOperationRegistry();
  registry.register(bumpValue);
  return registry;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'twograph-approval-'));
  writeFileSync(join(root, 'a.ts'), 'export const value = 1;\n');
  const db = openDatabase(':memory:');
  store = new MetadataStore(db);
  store.upsertRepository({ id: 'r', rootPath: root, name: 'r' });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('proposeEdit', () => {
  it('persists a pending preview without writing to disk', async () => {
    const edit = await proposeEdit(
      newRegistry(),
      { store, repo: 'r', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );

    expect(edit.status).toBe('pending');
    expect(edit.operation).toBe('bump_value');
    expect(edit.diff).toContain('-export const value = 1;');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('export const value = 1;\n');
  });
});

describe('approveEdit', () => {
  it('applies the diff, updates the file, marks the edit applied, and reindexes touched files', async () => {
    const edit = await proposeEdit(
      newRegistry(),
      { store, repo: 'r', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );

    const reindexed: string[][] = [];
    const resolved = await approveEdit(
      { store, rootPath: root, reindex: (paths) => Promise.resolve(void reindexed.push(paths)) },
      edit.id,
    );

    expect(resolved.status).toBe('applied');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('export const value = 42;\n');
    expect(reindexed).toEqual([['a.ts']]);
  });

  it('rejects approving an edit that has no pending preview', async () => {
    await expect(approveEdit({ store, rootPath: root }, 'not-a-real-id')).rejects.toThrow(
      /no pending edit preview/,
    );
  });

  it('rejects re-approving an edit that was already applied', async () => {
    const edit = await proposeEdit(
      newRegistry(),
      { store, repo: 'r', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );
    await approveEdit({ store, rootPath: root }, edit.id);

    await expect(approveEdit({ store, rootPath: root }, edit.id)).rejects.toThrow(
      /no pending edit preview/,
    );
  });

  it('expires and rejects when the file changed since preview (hash drift)', async () => {
    const edit = await proposeEdit(
      newRegistry(),
      { store, repo: 'r', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );

    writeFileSync(join(root, 'a.ts'), 'export const value = 999; // edited elsewhere\n');

    await expect(approveEdit({ store, rootPath: root }, edit.id)).rejects.toThrow(
      /file changed since preview/,
    );
    expect(store.getEdit(edit.id)?.status).toBe('expired');
    // The drifted content must survive untouched.
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe(
      'export const value = 999; // edited elsewhere\n',
    );
  });

  it('expires a pending edit once its ttl has elapsed', async () => {
    const edit = await proposeEdit(
      newRegistry(),
      { store, repo: 'r', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );

    await expect(approveEdit({ store, rootPath: root, expiryMs: -1 }, edit.id)).rejects.toThrow(
      /edit preview expired/,
    );
    expect(store.getEdit(edit.id)?.status).toBe('expired');
  });
});

describe('rejectEdit', () => {
  it('marks a pending edit rejected without touching disk', async () => {
    const edit = await proposeEdit(
      newRegistry(),
      { store, repo: 'r', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );

    const rejected = rejectEdit(store, edit.id);

    expect(rejected.status).toBe('rejected');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('export const value = 1;\n');
    await expect(approveEdit({ store, rootPath: root }, edit.id)).rejects.toThrow(
      /no pending edit preview/,
    );
  });
});

describe('revertEdit', () => {
  it('restores the exact pre-image after an apply', async () => {
    const edit = await proposeEdit(
      newRegistry(),
      { store, repo: 'r', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );
    await approveEdit({ store, rootPath: root }, edit.id);
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('export const value = 42;\n');

    const reverted = revertEdit(store, root, edit.id);

    expect(reverted.status).toBe('reverted');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('export const value = 1;\n');
  });

  it('refuses to revert when the file changed since it was applied', async () => {
    const edit = await proposeEdit(
      newRegistry(),
      { store, repo: 'r', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );
    await approveEdit({ store, rootPath: root }, edit.id);

    writeFileSync(join(root, 'a.ts'), 'export const value = 42; // touched again\n');

    expect(() => revertEdit(store, root, edit.id)).toThrow(/refusing to revert/);
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe(
      'export const value = 42; // touched again\n',
    );
  });

  it('refuses to revert an edit that was never applied', async () => {
    const edit = await proposeEdit(
      newRegistry(),
      { store, repo: 'r', rootPath: root, graphQueries: fakeGraphQueries() },
      'bump_value',
      { file: 'a.ts', from: '1', to: '42' },
    );
    expect(() => revertEdit(store, root, edit.id)).toThrow(/no applied edit to revert/);
  });
});
