import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserEngine, parseJsdoc } from '@twograph/parser';

const engine = new ParserEngine();

describe('parseJsdoc', () => {
  it('parses summary, params, returns, deprecated', () => {
    const doc = parseJsdoc(
      [
        '/**',
        ' * Adds two numbers.',
        ' * Second line of summary.',
        ' * @param a - first operand',
        ' * @param {number} b second operand',
        ' * @returns the sum',
        ' * @deprecated use addAll',
        ' */',
      ].join('\n'),
    );
    expect(doc.summary).toBe('Adds two numbers.\nSecond line of summary.');
    expect(doc.params).toEqual([
      { name: 'a', text: 'first operand' },
      { name: 'b', text: 'second operand' },
    ]);
    expect(doc.returns).toBe('the sum');
    expect(doc.deprecated).toBe('use addAll');
  });
});

describe('docsExtractor attachment', () => {
  it('attaches docs to functions, exported arrows, and methods', async () => {
    const { symbols } = await engine.parseFile(
      't',
      'a.ts',
      [
        '/** Greets. */',
        'export function greet() {}',
        '',
        '/** Doubles. */',
        'export const twice = (n: number) => n * 2;',
        '',
        'class Svc {',
        '  /** Runs the service. */',
        '  run() {}',
        '}',
      ].join('\n'),
    );
    expect(symbols.find((s) => s.name === 'greet')?.doc?.summary).toBe('Greets.');
    expect(symbols.find((s) => s.name === 'twice')?.doc?.summary).toBe('Doubles.');
    expect(symbols.find((s) => s.qualifiedName === 'Svc.run')?.doc?.summary).toBe(
      'Runs the service.',
    );
  });

  it('attaches interface/enum docs and leaves undocumented symbols bare', async () => {
    const { symbols } = await engine.parseFile(
      't',
      'a.ts',
      ['/** A user. */', 'export interface User { id: string }', 'export const bare = 1;'].join(
        '\n',
      ),
    );
    expect(symbols.find((s) => s.name === 'User')?.doc?.summary).toBe('A user.');
    expect(symbols.find((s) => s.name === 'bare')?.doc).toBeUndefined();
  });

  it('turns an orphan top-of-file block into fileDoc', async () => {
    const parsed = await engine.parseFile(
      't',
      'a.ts',
      [
        '/**',
        ' * Module for money math.',
        ' */',
        '',
        "import x from './x';",
        'const pad = 1;',
      ].join('\n'),
    );
    expect(parsed.fileDoc).toBe('Module for money math.');
  });

  it('sample-repo ground truth: verifyToken doc with params and throws context', async () => {
    const path = 'auth/jwt.ts';
    const source = readFileSync(
      join(import.meta.dirname, '../../../examples/sample-repo/src', path),
      'utf8',
    );
    const { symbols } = await engine.parseFile('sample', path, source);
    const doc = symbols.find((s) => s.name === 'verifyToken')?.doc;
    expect(doc?.summary).toContain('Verifies a JWT-shaped token');
    expect(doc?.params).toContainEqual({ name: 'token', text: 'raw bearer token' });
    expect(doc?.returns).toBe('the decoded payload');
  });
});
