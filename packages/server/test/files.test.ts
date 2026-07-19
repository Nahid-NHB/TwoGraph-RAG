import { describe, expect, it } from 'vitest';
import { buildFileTree } from '@twograph/server';

describe('buildFileTree', () => {
  it('nests paths into directories and files', () => {
    const tree = buildFileTree(['src/auth/jwt.ts', 'src/index.ts']);
    expect(tree).toEqual([
      {
        name: 'src',
        path: 'src',
        type: 'directory',
        children: [
          {
            name: 'auth',
            path: 'src/auth',
            type: 'directory',
            children: [{ name: 'jwt.ts', path: 'src/auth/jwt.ts', type: 'file', children: [] }],
          },
          { name: 'index.ts', path: 'src/index.ts', type: 'file', children: [] },
        ],
      },
    ]);
  });

  it('sorts directories before files, then alphabetically', () => {
    const tree = buildFileTree(['b.ts', 'zdir/z.ts', 'a.ts', 'adir/a.ts']);
    expect(tree.map((n) => n.name)).toEqual(['adir', 'zdir', 'a.ts', 'b.ts']);
  });

  it('merges files that share a directory', () => {
    const tree = buildFileTree(['auth/jwt.ts', 'auth/types.ts']);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((c) => c.name)).toEqual(['jwt.ts', 'types.ts']);
  });

  it('returns an empty tree for no paths', () => {
    expect(buildFileTree([])).toEqual([]);
  });
});
