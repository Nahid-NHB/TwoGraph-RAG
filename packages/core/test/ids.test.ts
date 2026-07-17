import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  formatChunkId,
  formatFileId,
  formatSymbolId,
  InvalidIdError,
  isSymbolId,
  parseChunkId,
  parseFileId,
  parseSymbolId,
} from '@twograph/core';

const repoArb = fc
  .stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,20}$/)
  .filter((s) => /^[A-Za-z0-9]/.test(s));

const pathSegArb = fc.stringMatching(/^[A-Za-z0-9_.-]{1,10}$/).filter((s) => !s.includes('~'));
const pathArb = fc.array(pathSegArb, { minLength: 1, maxLength: 4 }).map((segs) => segs.join('/'));

const nameSegArb = fc.stringMatching(/^[A-Za-z_$][A-Za-z0-9_$]{0,10}$/);
const qualifiedArb = fc
  .array(nameSegArb, { minLength: 1, maxLength: 3 })
  .map((segs) => segs.join('.'));

describe('symbol id codec', () => {
  it('round-trips arbitrary valid parts (property)', () => {
    fc.assert(
      fc.property(repoArb, pathArb, qualifiedArb, (repo, path, qualifiedName) => {
        const id = formatSymbolId({ repo, path, qualifiedName });
        expect(parseSymbolId(id)).toEqual({ repo, path, qualifiedName });
      }),
    );
  });

  it('file ids round-trip (property)', () => {
    fc.assert(
      fc.property(repoArb, pathArb, (repo, path) => {
        expect(parseFileId(formatFileId({ repo, path }))).toEqual({ repo, path });
      }),
    );
  });

  it('chunk ids round-trip with and without parts (property)', () => {
    fc.assert(
      fc.property(
        repoArb,
        pathArb,
        qualifiedArb,
        fc.option(fc.nat({ max: 99 }), { nil: undefined }),
        (repo, path, qualifiedName, part) => {
          const symbolId = formatSymbolId({ repo, path, qualifiedName });
          const chunkId = formatChunkId(symbolId, part);
          const parsed = parseChunkId(chunkId);
          expect(parsed.symbolId).toBe(symbolId);
          expect(parsed.part).toBe(part);
        },
      ),
    );
  });

  it('rejects malformed ids', () => {
    for (const bad of [
      '',
      'no-hash-or-colon',
      ':path#name',
      'repo:#name',
      'repo:path#',
      'repo:/abs/path#name',
      'repo:pa#th#name',
      'repo:path#na:me',
      'repo:path~1#name',
    ]) {
      expect(() => parseSymbolId(bad), bad).toThrow(InvalidIdError);
      expect(isSymbolId(bad), bad).toBe(false);
    }
  });

  it('rejects invalid inputs at format time', () => {
    expect(() => formatSymbolId({ repo: 'a:b', path: 'x.ts', qualifiedName: 'f' })).toThrow(
      InvalidIdError,
    );
    expect(() => formatSymbolId({ repo: 'r', path: '/abs.ts', qualifiedName: 'f' })).toThrow(
      InvalidIdError,
    );
    expect(() => formatSymbolId({ repo: 'r', path: 'x.ts', qualifiedName: 'a#b' })).toThrow(
      InvalidIdError,
    );
    expect(() => formatChunkId('repo:path.ts#fn', -1)).toThrow(InvalidIdError);
    expect(() => formatChunkId('not-a-symbol-id', 0)).toThrow(InvalidIdError);
  });

  it('parses realistic ids', () => {
    expect(parseSymbolId('myapp:src/auth/jwt.ts#AuthService.verifyToken')).toEqual({
      repo: 'myapp',
      path: 'src/auth/jwt.ts',
      qualifiedName: 'AuthService.verifyToken',
    });
  });
});
