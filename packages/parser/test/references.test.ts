import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserEngine } from '@twograph/parser';

const engine = new ParserEngine();
const SRC = join(import.meta.dirname, '../../../examples/sample-repo/src');
const parseSample = (rel: string) =>
  engine.parseFile('sample', rel, readFileSync(join(SRC, rel), 'utf8'));

describe('referencesExtractor: calls', () => {
  it('records file-local calls with their enclosing symbol', async () => {
    const { references } = await parseSample('auth/jwt.ts');
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'verifyToken', name: 'decodeToken', kind: 'call' }),
    );
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'verifyToken', name: 'validateJWT', kind: 'call' }),
    );
  });

  it('flags calls to imported functions for cross-file resolution', async () => {
    const { references } = await parseSample('api/users.ts');
    expect(references).toContainEqual(
      expect.objectContaining({
        from: 'fetchUser',
        name: 'fetchJson',
        kind: 'call',
        imported: true,
      }),
    );
  });

  it('records member-chain calls with imported base detection', async () => {
    const { references } = await parseSample('api/client.ts');
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'fetchJson', name: 'axios.request', imported: true }),
    );
  });

  it('attributes method-body calls to Class.method', async () => {
    const { references } = await parseSample('auth/authService.ts');
    expect(references).toContainEqual(
      expect.objectContaining({
        from: 'AuthService.login',
        name: 'authenticateUser',
        kind: 'call',
      }),
    );
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'AuthService.login', name: 'this.log', kind: 'call' }),
    );
  });
});

describe('referencesExtractor: module variable reads/writes with shadowing', () => {
  const FIXTURE = [
    'let counter = 0;',
    'export function inc() { counter += 1; return counter; }',
    'export function shadow(counter: number) { counter += 1; return counter; }',
    'export function bump() { counter++; }',
  ].join('\n');

  it('distinguishes reads from writes', async () => {
    const { references } = await engine.parseFile('t', 'a.ts', FIXTURE);
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'inc', name: 'counter', kind: 'write' }),
    );
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'inc', name: 'counter', kind: 'read' }),
    );
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'bump', name: 'counter', kind: 'write' }),
    );
  });

  it('respects parameter shadowing', async () => {
    const { references } = await engine.parseFile('t', 'a.ts', FIXTURE);
    const fromShadow = references.filter((r) => r.from === 'shadow' && r.name === 'counter');
    expect(fromShadow).toHaveLength(0);
  });

  it('respects local-variable shadowing', async () => {
    const { references } = await engine.parseFile(
      't',
      'a.ts',
      ['const flag = true;', 'function f() { const flag = false; return flag; }'].join('\n'),
    );
    expect(references.filter((r) => r.from === 'f' && r.name === 'flag')).toHaveLength(0);
  });
});
