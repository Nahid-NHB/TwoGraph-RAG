import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserEngine } from '@twograph/parser';

const engine = new ParserEngine();

describe('typesExtractor', () => {
  it('extracts interfaces with members and extends references', async () => {
    const { symbols, references } = await engine.parseFile(
      't',
      'a.ts',
      [
        'interface Base { id: string; }',
        'export interface Detailed extends Base { describe(): string; }',
      ].join('\n'),
    );
    expect(symbols.find((s) => s.name === 'Detailed')).toMatchObject({
      kind: 'interface',
      exported: true,
      meta: { members: ['describe'] },
    });
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'Detailed', name: 'Base', kind: 'extends' }),
    );
  });

  it('extracts enums with const flag and members', async () => {
    const { symbols } = await engine.parseFile(
      't',
      'a.ts',
      'export const enum Direction { Up, Down }',
    );
    expect(symbols.find((s) => s.name === 'Direction')).toMatchObject({
      kind: 'enum',
      exported: true,
      meta: { const: true, members: ['Up', 'Down'] },
    });
  });

  it('extracts type aliases with signatures', async () => {
    const { symbols } = await engine.parseFile(
      't',
      'a.ts',
      'export type Result<T> = { ok: true; value: T } | { ok: false };',
    );
    const alias = symbols.find((s) => s.name === 'Result');
    expect(alias?.kind).toBe('typeAlias');
    expect(alias?.signature).toContain('type Result =');
  });

  it('sample-repo ground truth: auth/types.ts entities', async () => {
    const path = 'auth/types.ts';
    const source = readFileSync(
      join(import.meta.dirname, '../../../examples/sample-repo/src', path),
      'utf8',
    );
    const { symbols } = await engine.parseFile('sample', path, source);
    const kindOf = (name: string) => symbols.find((s) => s.name === name)?.kind;
    expect(kindOf('Role')).toBe('enum');
    expect(kindOf('User')).toBe('interface');
    expect(kindOf('IAuthService')).toBe('interface');
    expect(kindOf('AuthState')).toBe('typeAlias');
    expect(kindOf('TokenPayload')).toBe('typeAlias');
    expect(symbols.find((s) => s.name === 'Role')?.meta['members']).toEqual([
      'Admin',
      'Member',
      'Guest',
    ]);
  });
});
