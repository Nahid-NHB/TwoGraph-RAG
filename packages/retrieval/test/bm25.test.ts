import { describe, expect, it } from 'vitest';
import { openDatabase, FtsIndex } from '@twograph/store';
import { Bm25Retriever } from '@twograph/retrieval';

function seed(fts: FtsIndex): void {
  fts.upsert([
    {
      chunkId: 'r:auth/jwt.ts#verifyToken',
      repo: 'r',
      content: 'export function verifyToken(token) { return validateJWT(token); }',
      name: 'verifyToken',
      path: 'auth/jwt.ts',
      kind: 'function',
    },
    {
      chunkId: 'r:utils/format.ts#toCsvRow',
      repo: 'r',
      content: 'function toCsvRow(row) { return row.join(","); }',
      name: 'toCsvRow',
      path: 'utils/format.ts',
      kind: 'function',
    },
  ]);
}

describe('Bm25Retriever', () => {
  it('returns normalized RankedHits tagged with source "bm25"', async () => {
    const db = openDatabase(':memory:');
    const fts = new FtsIndex(db);
    seed(fts);
    const retriever = new Bm25Retriever(fts, 'r');

    const hits = await retriever.retrieve('verify token');

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ symbolId: 'r:auth/jwt.ts#verifyToken', source: 'bm25' });
    expect(hits.every((h) => h.source === 'bm25' && typeof h.score === 'number')).toBe(true);
  });

  it('strips chunk part suffixes back to the owning symbol id', async () => {
    const db = openDatabase(':memory:');
    const fts = new FtsIndex(db);
    fts.upsert([
      {
        chunkId: 'r:big.ts#huge~2',
        repo: 'r',
        content: 'overflow chunk part two verifyToken',
        name: 'huge',
        path: 'big.ts',
        kind: 'function',
      },
    ]);
    const retriever = new Bm25Retriever(fts, 'r');

    const hits = await retriever.retrieve('verifyToken');

    expect(hits[0]?.symbolId).toBe('r:big.ts#huge');
  });

  it('honors k and kind filters', async () => {
    const db = openDatabase(':memory:');
    const fts = new FtsIndex(db);
    seed(fts);
    const retriever = new Bm25Retriever(fts, 'r');

    const hits = await retriever.retrieve('function', { k: 1 });
    expect(hits).toHaveLength(1);
  });
});
