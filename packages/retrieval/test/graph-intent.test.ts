import { describe, expect, it } from 'vitest';
import { detectGraphIntent } from '@twograph/retrieval';

describe('detectGraphIntent', () => {
  it('detects "who calls X" as a callers intent naming X', () => {
    expect(detectGraphIntent('who calls verifyToken')).toEqual({
      kind: 'callers',
      candidates: ['verifyToken'],
    });
  });

  it('detects "callers of X"', () => {
    expect(detectGraphIntent('callers of validateJWT')).toEqual({
      kind: 'callers',
      candidates: ['validateJWT'],
    });
  });

  it('detects "callees of X" / "what does X call"', () => {
    expect(detectGraphIntent('callees of loginHandler')?.kind).toBe('callees');
    expect(detectGraphIntent('what does loginHandler call')?.kind).toBe('callees');
  });

  it('detects "usage of X" / "who uses X" / "X used by"', () => {
    expect(detectGraphIntent('usage of Button')?.kind).toBe('usage');
    expect(detectGraphIntent('who uses Button')?.kind).toBe('usage');
    expect(detectGraphIntent('where is Button used by other components')?.kind).toBe('usage');
  });

  it('returns null for queries with no graph intent', () => {
    expect(detectGraphIntent('how do I validate a jwt token')).toBeNull();
    expect(detectGraphIntent('authentication flow overview')).toBeNull();
  });

  it('returns null when an intent phrase has no identifier left over', () => {
    expect(detectGraphIntent('who calls')).toBeNull();
  });
});
