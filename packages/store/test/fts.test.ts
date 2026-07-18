import { describe, expect, it } from 'vitest';
import { FtsIndex, openDatabase, splitIdentifiers } from '@twograph/store';

function freshIndex(): FtsIndex {
  const fts = new FtsIndex(openDatabase(':memory:'));
  fts.upsert([
    {
      chunkId: 'r:api/users.ts#fetchUser',
      repo: 'r',
      name: 'fetchUser',
      path: 'api/users.ts',
      kind: 'function',
      content: 'export function fetchUser(id: string) { return fetchJson(`/api/users/${id}`); }',
    },
    {
      chunkId: 'r:api/misc.ts#helper',
      repo: 'r',
      name: 'helper',
      path: 'api/misc.ts',
      kind: 'function',
      content: 'function helper() { /* mentions fetchUser in a comment */ return fetchUser; }',
    },
    {
      chunkId: 'r:components/Card.tsx#Card',
      repo: 'r',
      name: 'Card',
      path: 'components/Card.tsx',
      kind: 'component',
      content: 'export function Card({ user }: Props) { return <div>{user.name}</div>; }',
    },
  ]);
  return fts;
}

describe('splitIdentifiers', () => {
  it('splits camelCase, snake_case, and preserves originals', () => {
    expect(splitIdentifiers('fetchUser')).toEqual(
      expect.arrayContaining(['fetchuser', 'fetch', 'user']),
    );
    expect(splitIdentifiers('fetch_user')).toEqual(expect.arrayContaining(['fetch', 'user']));
    expect(splitIdentifiers('HTTPServer')).toEqual(
      expect.arrayContaining(['httpserver', 'http', 'server']),
    );
  });
});

describe('FtsIndex BM25 search', () => {
  it('finds fetchUser via camelCase, spaced, and snake_case queries', () => {
    const fts = freshIndex();
    for (const query of ['fetchUser', 'fetch user', 'fetch_user']) {
      const hits = fts.search('r', query);
      expect(
        hits.map((h) => h.chunkId),
        query,
      ).toContain('r:api/users.ts#fetchUser');
    }
  });

  it('ranks name matches above content-only matches', () => {
    const fts = freshIndex();
    const hits = fts.search('r', 'fetchUser');
    expect(hits[0]?.chunkId).toBe('r:api/users.ts#fetchUser');
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('applies kind and path filters', () => {
    const fts = freshIndex();
    expect(fts.search('r', 'user', 10, { kinds: ['component'] }).map((h) => h.kind)).toEqual([
      'component',
    ]);
    const filtered = fts.search('r', 'fetchUser', 10, { pathPrefix: 'api/misc' });
    expect(filtered.map((h) => h.chunkId)).toEqual(['r:api/misc.ts#helper']);
  });

  it('stays consistent through updates and deletes', () => {
    const fts = freshIndex();
    fts.upsert([
      {
        chunkId: 'r:api/users.ts#fetchUser',
        repo: 'r',
        name: 'loadUser',
        path: 'api/users.ts',
        kind: 'function',
        content: 'export function loadUser() {}',
      },
    ]);
    const hits = fts.search('r', 'loadUser');
    expect(hits[0]?.chunkId).toBe('r:api/users.ts#fetchUser');
    // Replaced, not appended: exactly one row for the chunk, no stale name.
    expect(hits.filter((h) => h.chunkId === 'r:api/users.ts#fetchUser')).toHaveLength(1);
    expect(hits.some((h) => h.name === 'fetchUser')).toBe(false);

    fts.deleteByPath('r', 'api/users.ts');
    expect(fts.search('r', 'loadUser').some((h) => h.path === 'api/users.ts')).toBe(false);
    expect(fts.search('r', 'helper').length).toBeGreaterThan(0);
  });

  it('scopes results by repo and survives odd queries', () => {
    const fts = freshIndex();
    expect(fts.search('other', 'fetchUser')).toHaveLength(0);
    expect(fts.search('r', '???')).toHaveLength(0);
    expect(fts.search('r', 'user "quoted" OR NEAR(')).not.toHaveLength(0);
  });
});
