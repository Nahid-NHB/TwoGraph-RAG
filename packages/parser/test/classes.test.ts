import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserEngine } from '@twograph/parser';

const engine = new ParserEngine();

const TS = [
  'interface Runnable { run(): void; }',
  'export abstract class Base {',
  '  protected log(msg: string): void { console.log(msg); }',
  '}',
  'export class Worker extends Base implements Runnable {',
  '  static count = 0;',
  '  private secret = 1;',
  '  async run(): Promise<void> {}',
  '  static reset(): void { Worker.count = 0; }',
  '}',
].join('\n');

describe('classesExtractor', () => {
  it('extracts classes with abstract flag and export state', async () => {
    const { symbols } = await engine.parseFile('t', 'a.ts', TS);
    const base = symbols.find((s) => s.name === 'Base');
    const worker = symbols.find((s) => s.name === 'Worker');
    expect(base).toMatchObject({ kind: 'class', exported: true, meta: { abstract: true } });
    expect(worker).toMatchObject({ kind: 'class', exported: true, meta: { abstract: false } });
  });

  it('extracts methods with modifiers and class-qualified IDs', async () => {
    const { symbols } = await engine.parseFile('t', 'a.ts', TS);
    const log = symbols.find((s) => s.qualifiedName === 'Base.log');
    const run = symbols.find((s) => s.qualifiedName === 'Worker.run');
    const reset = symbols.find((s) => s.qualifiedName === 'Worker.reset');
    expect(log).toMatchObject({ kind: 'method', meta: { visibility: 'protected' } });
    expect(run).toMatchObject({ kind: 'method', meta: { async: true, static: false } });
    expect(reset).toMatchObject({ kind: 'method', meta: { static: true } });
    expect(run?.id).toBe('t:a.ts#Worker.run');
  });

  it('records extends and implements references', async () => {
    const { references } = await engine.parseFile('t', 'a.ts', TS);
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'Worker', name: 'Base', kind: 'extends' }),
    );
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'Worker', name: 'Runnable', kind: 'implements' }),
    );
  });

  it('handles plain JS classes (heritage without clauses)', async () => {
    const { symbols, references } = await engine.parseFile(
      't',
      'a.js',
      'class A {}\nclass B extends A { go() {} }',
    );
    expect(symbols.find((s) => s.name === 'B')?.kind).toBe('class');
    expect(symbols.find((s) => s.qualifiedName === 'B.go')?.kind).toBe('method');
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'B', name: 'A', kind: 'extends' }),
    );
  });

  it('sample-repo ground truth: AuthService hierarchy', async () => {
    const path = 'auth/authService.ts';
    const source = readFileSync(
      join(import.meta.dirname, '../../../examples/sample-repo/src', path),
      'utf8',
    );
    const { symbols, references } = await engine.parseFile('sample', path, source);
    expect(symbols.find((s) => s.name === 'BaseService')?.meta).toMatchObject({ abstract: true });
    const methodNames = symbols.filter((s) => s.kind === 'method').map((s) => s.qualifiedName);
    expect(methodNames).toEqual(
      expect.arrayContaining([
        'BaseService.log',
        'AuthService.login',
        'AuthService.logout',
        'AuthService.currentUser',
      ]),
    );
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'AuthService', name: 'BaseService', kind: 'extends' }),
    );
    expect(references).toContainEqual(
      expect.objectContaining({ from: 'AuthService', name: 'IAuthService', kind: 'implements' }),
    );
  });
});
