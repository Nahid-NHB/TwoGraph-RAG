import { describe, expect, it } from 'vitest';
import type { CodeSymbol } from '@twograph/core';
import { KIND_LABEL, symbolProps } from '@twograph/graph';

const symbol: CodeSymbol = {
  id: 'r:src/a.tsx#Card',
  repo: 'r',
  path: 'src/a.tsx',
  kind: 'component',
  name: 'Card',
  qualifiedName: 'Card',
  span: { startLine: 3, endLine: 9 },
  signature: 'function Card()',
  doc: { summary: 'A card.', params: [], raw: '/** A card. */' },
  exported: true,
  contentHash: 'abc',
  meta: { componentKind: 'function', jsxUsage: { Button: 2 }, props: ['title'] },
};

describe('symbolProps', () => {
  it('lifts scalar meta, serializes the rest, and flattens doc/span', () => {
    const props = symbolProps(symbol);
    expect(props).toMatchObject({
      repoId: 'r',
      startLine: 3,
      endLine: 9,
      doc: 'A card.',
      componentKind: 'function',
      exported: true,
    });
    expect(JSON.parse(props['meta'] as string)).toEqual({
      jsxUsage: { Button: 2 },
      props: ['title'],
    });
  });

  it('maps every symbol kind to a documented label', () => {
    expect(Object.keys(KIND_LABEL)).toHaveLength(13);
    expect(KIND_LABEL.component).toBe('Component');
    expect(KIND_LABEL.typeAlias).toBe('TypeAlias');
  });
});
