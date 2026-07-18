import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CodeSymbol } from '@twograph/core';
import { ParserEngine } from '@twograph/parser';

const engine = new ParserEngine();

async function symbolsOf(path: string, source: string): Promise<CodeSymbol[]> {
  const parsed = await engine.parseFile('t', path, source);
  return parsed.symbols;
}

const byName = (symbols: CodeSymbol[], name: string) => symbols.find((s) => s.name === name);

describe('symbolsExtractor: functions', () => {
  it('extracts function declarations with signature, span, export flag', async () => {
    const symbols = await symbolsOf(
      'a.ts',
      [
        '/** doc */',
        'export function greet(name: string): string {',
        '  return `hi ${name}`;',
        '}',
        'function local() {}',
      ].join('\n'),
    );
    const greet = byName(symbols, 'greet');
    expect(greet).toMatchObject({
      kind: 'function',
      qualifiedName: 'greet',
      exported: true,
      id: 't:a.ts#greet',
    });
    expect(greet?.signature).toBe('function greet(name: string): string');
    expect(greet?.span).toEqual({ startLine: 2, endLine: 4 });
    expect(byName(symbols, 'local')).toMatchObject({ exported: false });
  });

  it('extracts named arrow functions and function expressions', async () => {
    const symbols = await symbolsOf(
      'a.ts',
      [
        'export const add = (a: number, b: number): number => a + b;',
        'const mul = function (a: number, b: number) { return a * b; };',
        'export const later = async () => Promise.resolve(1);',
      ].join('\n'),
    );
    expect(byName(symbols, 'add')).toMatchObject({
      kind: 'function',
      exported: true,
      meta: { arrow: true },
    });
    expect(byName(symbols, 'mul')).toMatchObject({ kind: 'function', exported: false });
    expect(byName(symbols, 'later')?.meta).toMatchObject({ async: true, arrow: true });
  });

  it('qualifies nested functions by their parent scope', async () => {
    const symbols = await symbolsOf(
      'a.ts',
      ['function outer() {', '  function inner() {}', '  const helper = () => 1;', '}'].join('\n'),
    );
    expect(byName(symbols, 'inner')?.qualifiedName).toBe('outer.inner');
    expect(byName(symbols, 'helper')?.id).toBe('t:a.ts#outer.helper');
  });

  it('extracts generators with meta', async () => {
    const symbols = await symbolsOf('a.ts', 'export function* gen() { yield 1; }');
    expect(byName(symbols, 'gen')?.meta).toMatchObject({ generator: true });
  });
});

describe('symbolsExtractor: module variables', () => {
  it('extracts module-level constants but not function-local ones', async () => {
    const symbols = await symbolsOf(
      'a.ts',
      [
        'export const API_BASE = "/api";',
        'let counter = 0;',
        'function f() { const localOnly = 1; return localOnly; }',
      ].join('\n'),
    );
    expect(byName(symbols, 'API_BASE')).toMatchObject({
      kind: 'variable',
      exported: true,
      meta: { varKind: 'const' },
    });
    expect(byName(symbols, 'counter')).toMatchObject({ kind: 'variable', exported: false });
    expect(byName(symbols, 'localOnly')).toBeUndefined();
  });

  it('does not double-report arrow functions as variables', async () => {
    const symbols = await symbolsOf('a.ts', 'export const fn = () => 1;');
    expect(symbols.filter((s) => s.name === 'fn')).toHaveLength(1);
    expect(byName(symbols, 'fn')?.kind).toBe('function');
  });
});

describe('symbolsExtractor: sample-repo ground truth', () => {
  const SRC = join(import.meta.dirname, '../../../examples/sample-repo/src');

  it('finds the auth flow functions in jwt.ts', async () => {
    const source = readFileSync(join(SRC, 'auth/jwt.ts'), 'utf8');
    const symbols = await symbolsOf('auth/jwt.ts', source);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['verifyToken', 'validateJWT', 'signToken', 'decodeToken', 'SECRET']),
    );
    expect(byName(symbols, 'verifyToken')?.exported).toBe(true);
    expect(byName(symbols, 'decodeToken')?.exported).toBe(false);
  });

  it('finds useDebounce (refined to hook kind by the react-hooks pass)', async () => {
    const source = readFileSync(join(SRC, 'hooks/useDebounce.ts'), 'utf8');
    const symbols = await symbolsOf('hooks/useDebounce.ts', source);
    expect(byName(symbols, 'useDebounce')?.kind).toBe('hook');
  });
});
