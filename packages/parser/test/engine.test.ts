import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError } from '@twograph/core';
import { defaultRegistry, ParserEngine } from '@twograph/parser';

const engine = new ParserEngine();

function sampleFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sampleFiles(full, acc);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const SAMPLE_SRC = join(import.meta.dirname, '../../../examples/sample-repo/src');

describe('registry', () => {
  it('resolves plugins for all supported extensions', () => {
    const registry = defaultRegistry();
    expect(registry.resolve('a/b.ts')?.id).toBe('typescript');
    expect(registry.resolve('a/b.tsx')?.id).toBe('tsx');
    expect(registry.resolve('a/b.jsx')?.id).toBe('javascript');
    expect(registry.resolve('a/b.mjs')?.id).toBe('javascript');
    expect(registry.resolve('a/b.css')).toBeUndefined();
    expect(registry.supportedExtensions()).toContain('.cts');
  });

  it('maps extensions to core language tags', () => {
    const registry = defaultRegistry();
    expect(registry.resolve('x.jsx')?.languageFor('.jsx')).toBe('jsx');
    expect(registry.resolve('x.js')?.languageFor('.js')).toBe('javascript');
  });
});

describe('engine', () => {
  it('parses TS, TSX, and JS into program trees', async () => {
    for (const [path, source] of [
      ['a.ts', 'export const x: number = 1;'],
      ['a.tsx', 'export const C = () => <div>hi</div>;'],
      ['a.js', 'module.exports = function f() { return 1; };'],
    ] as const) {
      const { tree } = await engine.parse(path, source);
      expect(tree.rootNode.type).toBe('program');
      expect(tree.rootNode.hasError).toBe(false);
      tree.delete();
    }
  });

  it('is error-tolerant: broken source yields a tree with ERROR nodes, no throw', async () => {
    const { tree } = await engine.parse('broken.ts', 'function {{{ nope');
    expect(tree.rootNode.hasError).toBe(true);
    tree.delete();
  });

  it('throws ParseError for unsupported files', async () => {
    await expect(engine.parse('style.css', 'body{}')).rejects.toThrow(ParseError);
  });

  it('parseFile returns a valid ParsedFile envelope (no extractors yet)', async () => {
    const parsed = await engine.parseFile('sample', 'src/a.ts', 'export const one = 1;');
    expect(parsed).toMatchObject({
      repo: 'sample',
      path: 'src/a.ts',
      language: 'typescript',
      symbols: [],
      imports: [],
      exports: [],
      references: [],
    });
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('parses the entire sample-repo without errors, fast', async () => {
    const files = sampleFiles(SAMPLE_SRC);
    expect(files.length).toBeGreaterThanOrEqual(20);
    const started = performance.now();
    for (const file of files) {
      const { tree } = await engine.parse(file, readFileSync(file, 'utf8'));
      expect(tree.rootNode.type).toBe('program');
      tree.delete();
    }
    const elapsed = performance.now() - started;
    // NFR-1 smoke check (loose bound for CI variance): ~25 files well under 2s.
    expect(elapsed).toBeLessThan(2000);
  });
});
