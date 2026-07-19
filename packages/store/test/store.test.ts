import { describe, expect, it } from 'vitest';
import type { ParsedFile } from '@twograph/core';
import { applyMigrations, MetadataStore, openDatabase } from '@twograph/store';

const parsedFixture = (over: Partial<ParsedFile> = {}): ParsedFile => ({
  repo: 'r',
  path: 'src/a.ts',
  language: 'typescript',
  contentHash: 'h1',
  symbols: [
    {
      id: 'r:src/a.ts#fn',
      repo: 'r',
      path: 'src/a.ts',
      kind: 'function',
      name: 'fn',
      qualifiedName: 'fn',
      span: { startLine: 1, endLine: 3 },
      signature: 'function fn()',
      exported: true,
      contentHash: 'sh1',
      meta: {},
    },
  ],
  imports: [],
  exports: [],
  references: [],
  ...over,
});

function freshStore(): MetadataStore {
  const db = openDatabase(':memory:');
  const store = new MetadataStore(db);
  store.upsertRepository({ id: 'r', rootPath: '/tmp/r', name: 'repo' });
  return store;
}

describe('migrations', () => {
  it('apply idempotently from empty and re-applied', () => {
    const db = openDatabase(':memory:');
    applyMigrations(db);
    applyMigrations(db);
    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as {
      value: string;
    };
    expect(Number(version.value)).toBeGreaterThanOrEqual(1);
  });
});

describe('MetadataStore', () => {
  it('repository CRUD and touch', () => {
    const store = freshStore();
    expect(store.getRepository('r')?.name).toBe('repo');
    expect(store.listRepositories()).toHaveLength(1);
    store.touchRepository('r');
    expect(store.getRepository('r')?.last_indexed).not.toBeNull();
  });

  it('replaceFile writes file + symbols and is re-runnable', () => {
    const store = freshStore();
    store.replaceFile(parsedFixture(), 100);
    store.replaceFile(parsedFixture({ contentHash: 'h2' }), 120);
    expect(store.fileHashes('r').get('src/a.ts')).toBe('h2');
    expect(store.getSymbol('r:src/a.ts#fn')?.name).toBe('fn');
    expect(store.symbolsByFile('r:src/a.ts')).toHaveLength(1);
  });

  it('deleting a file cascades to symbols (and chunks)', () => {
    const store = freshStore();
    store.replaceFile(parsedFixture(), 100);
    store.db
      .prepare(
        `INSERT INTO chunks (id, symbol_id, repo_id, content, content_hash) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('r:src/a.ts#fn', 'r:src/a.ts#fn', 'r', 'function fn()', 'ch1');
    store.deleteFile('r', 'src/a.ts');
    expect(store.getSymbol('r:src/a.ts#fn')).toBeUndefined();
    const chunks = store.db.prepare(`SELECT count(*) AS c FROM chunks`).get() as { c: number };
    expect(chunks.c).toBe(0);
  });

  it('fileHashes powers the incremental diff', () => {
    const store = freshStore();
    store.replaceFile(parsedFixture(), 100);
    store.replaceFile(parsedFixture({ path: 'src/b.ts', symbols: [] }), 50);
    const hashes = store.fileHashes('r');
    expect(hashes.size).toBe(2);
    expect(hashes.get('src/b.ts')).toBe('h1');
  });

  it('index runs record lifecycle and errors', () => {
    const store = freshStore();
    const id = store.startIndexRun('r', 'full');
    store.finishIndexRun(id, { added: 5, changed: 2, removed: 1 });
    expect(store.getIndexRun(id)).toMatchObject({
      kind: 'full',
      files_added: 5,
      files_changed: 2,
      files_removed: 1,
      error: null,
    });
    const failed = store.startIndexRun('r', 'incremental');
    store.finishIndexRun(failed, { added: 0, changed: 0, removed: 0 }, 'boom');
    expect(store.getIndexRun(failed)?.error).toBe('boom');
  });

  it('transactions roll back on error', () => {
    const store = freshStore();
    expect(() =>
      store.transaction(() => {
        store.upsertRepository({ id: 'x', rootPath: '/x', name: 'x' });
        throw new Error('fail');
      }),
    ).toThrow('fail');
    expect(store.getRepository('x')).toBeUndefined();
  });

  it('symbolsByIds hydrates in bulk', () => {
    const store = freshStore();
    store.replaceFile(parsedFixture(), 100);
    expect(store.symbolsByIds(['r:src/a.ts#fn', 'missing'])).toHaveLength(1);
    expect(store.symbolsByIds([])).toHaveLength(0);
  });
});
