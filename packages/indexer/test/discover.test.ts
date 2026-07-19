import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffFiles, discoverFiles } from '@twograph/indexer';

describe('discoverFiles', () => {
  it('walks recursively, filters extensions, honors ignores', () => {
    const root = mkdtempSync(join(tmpdir(), 'twograph-disc-'));
    mkdirSync(join(root, 'src/deep'), { recursive: true });
    mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
    mkdirSync(join(root, 'generated'), { recursive: true });
    writeFileSync(join(root, 'src/a.ts'), 'export {}');
    writeFileSync(join(root, 'src/deep/b.tsx'), 'export {}');
    writeFileSync(join(root, 'src/styles.css'), 'body{}');
    writeFileSync(join(root, 'node_modules/pkg/x.ts'), 'export {}');
    writeFileSync(join(root, 'generated/gen.ts'), 'export {}');

    const files = discoverFiles(root, ['.ts', '.tsx'], ['generated/**']);
    expect(files.map((f) => f.relPath)).toEqual(['src/a.ts', 'src/deep/b.tsx']);
  });
});

describe('diffFiles', () => {
  it('classifies added/changed/removed/unchanged', () => {
    const discovered = new Map([
      ['a.ts', 'h1'],
      ['b.ts', 'h2-new'],
      ['c.ts', 'h3'],
    ]);
    const stored = new Map([
      ['b.ts', 'h2-old'],
      ['c.ts', 'h3'],
      ['gone.ts', 'h4'],
    ]);
    expect(diffFiles(discovered, stored)).toEqual({
      added: ['a.ts'],
      changed: ['b.ts'],
      removed: ['gone.ts'],
      unchanged: ['c.ts'],
    });
  });
});
