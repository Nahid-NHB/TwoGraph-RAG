import { describe, expect, it } from 'vitest';
import { MetadataStore, openDatabase } from '@twograph/store';

function seededStore(): MetadataStore {
  const db = openDatabase(':memory:');
  const store = new MetadataStore(db);
  store.upsertRepository({ id: 'r', rootPath: '/tmp/r', name: 'r' });
  return store;
}

describe('edits (pending previews)', () => {
  it('creates a pending edit and reloads it by id', () => {
    const store = seededStore();
    const created = store.createEdit(
      'r',
      'rename_symbol',
      JSON.stringify({ symbolId: 'r:a.ts#f', newName: 'g' }),
      '--- a/a.ts\n+++ b/a.ts\n',
      { 'a.ts': 'abc123' },
    );

    expect(created.status).toBe('pending');
    expect(created.resolved_at).toBeNull();
    expect(store.getEdit(created.id)).toEqual(created);
  });

  it('lists edits for a repo, newest first, optionally filtered by status', () => {
    const store = seededStore();
    const a = store.createEdit('r', 'op', '{}', 'diff-a', {});
    const b = store.createEdit('r', 'op', '{}', 'diff-b', {});
    store.resolveEdit(a.id, 'rejected');

    expect(store.listEdits('r').map((e) => e.id)).toEqual([b.id, a.id]);
    expect(store.listEdits('r', 'pending').map((e) => e.id)).toEqual([b.id]);
    expect(store.listEdits('r', 'rejected').map((e) => e.id)).toEqual([a.id]);
  });

  it('resolveEdit sets status, resolved_at, and the applied-files journal', () => {
    const store = seededStore();
    const edit = store.createEdit('r', 'op', '{}', 'diff', { 'a.ts': 'h1' });
    expect(edit.resolved_at).toBeNull();

    store.resolveEdit(
      edit.id,
      'applied',
      JSON.stringify({ 'a.ts': { before: 'old', afterHash: 'h2' } }),
    );

    const resolved = store.getEdit(edit.id);
    expect(resolved?.status).toBe('applied');
    expect(resolved?.resolved_at).not.toBeNull();
    expect(JSON.parse(resolved?.applied_files_json ?? '{}')).toEqual({
      'a.ts': { before: 'old', afterHash: 'h2' },
    });
  });

  it('isEditExpired is false within the ttl and true once the ttl has elapsed', () => {
    const store = seededStore();
    const edit = store.createEdit('r', 'op', '{}', 'diff', {});
    expect(store.isEditExpired(edit.id, 60 * 60 * 1000)).toBe(false);
    // A negative ttl guarantees "elapsed" regardless of sub-second timing
    // between the insert and this check (datetime('now') has 1s resolution).
    expect(store.isEditExpired(edit.id, -1)).toBe(true);
  });
});
