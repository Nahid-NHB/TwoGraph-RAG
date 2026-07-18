// Fixture test file — exercises TESTS edge extraction. Not run by the monorepo test suite.
import { signToken, validateJWT, verifyToken } from './jwt';
import { Role } from './types';

declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
declare function expect(value: unknown): { toBe(v: unknown): void; toBeTruthy(): void };

describe('jwt', () => {
  it('verifies tokens it signed', () => {
    const token = signToken('1', Role.Admin);
    expect(verifyToken(token).sub).toBe('1');
  });

  it('validates token shape', () => {
    expect(validateJWT('a.b.c')).toBeTruthy();
  });
});
