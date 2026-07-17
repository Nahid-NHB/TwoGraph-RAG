import { describe, expect, it } from 'vitest';
import {
  codeSymbolSchema,
  edgeKindSchema,
  parsedFileSchema,
  rankedHitSchema,
} from '@twograph/core';

const symbol = {
  id: 'app:src/a.ts#fn',
  repo: 'app',
  path: 'src/a.ts',
  kind: 'function',
  name: 'fn',
  qualifiedName: 'fn',
  span: { startLine: 1, endLine: 3 },
  contentHash: 'abc123',
};

describe('domain schemas', () => {
  it('parses a minimal valid symbol and applies defaults', () => {
    const parsed = codeSymbolSchema.parse(symbol);
    expect(parsed.exported).toBe(false);
    expect(parsed.meta).toEqual({});
  });

  it('rejects unknown symbol kinds and bad spans', () => {
    expect(codeSymbolSchema.safeParse({ ...symbol, kind: 'gizmo' }).success).toBe(false);
    expect(
      codeSymbolSchema.safeParse({ ...symbol, span: { startLine: 0, endLine: 1 } }).success,
    ).toBe(false);
  });

  it('parses a full ParsedFile', () => {
    const file = parsedFileSchema.parse({
      repo: 'app',
      path: 'src/a.ts',
      language: 'typescript',
      contentHash: 'h',
      symbols: [symbol],
      imports: [
        {
          source: './b',
          sourceType: 'relative',
          specifiers: [{ local: 'b', imported: 'default' }],
          kind: 'static',
          line: 1,
        },
      ],
      exports: [{ name: 'fn', local: 'fn', kind: 'named', line: 3 }],
      references: [{ name: 'b', kind: 'call', line: 2 }],
    });
    expect(file.references[0]?.imported).toBe(false);
  });

  it('covers all documented edge kinds', () => {
    expect(edgeKindSchema.options).toHaveLength(20);
    expect(edgeKindSchema.options).toContain('PROVIDES_CONTEXT');
  });

  it('ranked hits default provenance', () => {
    const hit = rankedHitSchema.parse({ symbolId: symbol.id, score: 0.5, source: 'bm25' });
    expect(hit.provenance).toEqual({});
  });
});
