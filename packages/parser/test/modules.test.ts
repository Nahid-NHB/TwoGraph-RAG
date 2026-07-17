import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserEngine } from '@twograph/parser';

const engine = new ParserEngine();

describe('modulesExtractor: imports', () => {
  it('extracts every static import form', async () => {
    const { imports } = await engine.parseFile(
      't',
      'a.ts',
      [
        "import def from './def';",
        "import * as ns from 'pkg';",
        "import { a, b as c } from 'node:fs';",
        "import './side-effect.css';",
      ].join('\n'),
    );
    expect(imports).toContainEqual(
      expect.objectContaining({
        source: './def',
        sourceType: 'relative',
        specifiers: [{ local: 'def', imported: 'default' }],
      }),
    );
    expect(imports).toContainEqual(
      expect.objectContaining({
        source: 'pkg',
        sourceType: 'package',
        specifiers: [{ local: 'ns', imported: '*' }],
      }),
    );
    expect(imports).toContainEqual(
      expect.objectContaining({
        source: 'node:fs',
        sourceType: 'builtin',
        specifiers: [
          { local: 'a', imported: 'a' },
          { local: 'c', imported: 'b' },
        ],
      }),
    );
    expect(imports).toContainEqual(
      expect.objectContaining({ source: './side-effect.css', kind: 'sideEffect' }),
    );
  });

  it('extracts dynamic imports and require calls with line numbers', async () => {
    const { imports } = await engine.parseFile(
      't',
      'a.ts',
      ["const page = () => import('./lazy');", "const legacy = require('old-pkg');"].join('\n'),
    );
    expect(imports).toContainEqual(
      expect.objectContaining({ source: './lazy', kind: 'dynamic', line: 1 }),
    );
    expect(imports).toContainEqual(
      expect.objectContaining({ source: 'old-pkg', kind: 'require', line: 2 }),
    );
  });
});

describe('modulesExtractor: exports', () => {
  it('extracts named, default, re-export, and star forms', async () => {
    const { exports } = await engine.parseFile(
      't',
      'a.ts',
      [
        'export const x = 1, y = 2;',
        'export function fn() {}',
        'export default class Main {}',
        "export { x as ex } from './other';",
        "export * from './star';",
        'const z = 3;',
        'export { z };',
      ].join('\n'),
    );
    expect(exports).toContainEqual(expect.objectContaining({ name: 'x', kind: 'named' }));
    expect(exports).toContainEqual(expect.objectContaining({ name: 'y', kind: 'named' }));
    expect(exports).toContainEqual(expect.objectContaining({ name: 'fn', kind: 'named' }));
    expect(exports).toContainEqual(
      expect.objectContaining({ name: 'default', kind: 'default', local: 'Main' }),
    );
    expect(exports).toContainEqual(
      expect.objectContaining({ name: 'ex', local: 'x', kind: 'reExport', source: './other' }),
    );
    expect(exports).toContainEqual(
      expect.objectContaining({ name: '*', kind: 'star', source: './star' }),
    );
    expect(exports).toContainEqual(expect.objectContaining({ name: 'z', kind: 'named' }));
  });
});

describe('modulesExtractor: sample-repo ground truth', () => {
  const SRC = join(import.meta.dirname, '../../../examples/sample-repo/src');
  const parse = (rel: string) =>
    engine.parseFile('sample', rel, readFileSync(join(SRC, rel), 'utf8'));

  it('barrel utils/index.ts yields star + named re-exports', async () => {
    const { exports } = await parse('utils/index.ts');
    expect(exports).toContainEqual(expect.objectContaining({ kind: 'star', source: './format' }));
    expect(exports).toContainEqual(
      expect.objectContaining({ name: 'APP_NAME', kind: 'reExport', source: './constants' }),
    );
  });

  it('App.tsx records the dynamic SettingsPage import', async () => {
    const { imports } = await parse('App.tsx');
    expect(imports).toContainEqual(
      expect.objectContaining({ source: './pages/SettingsPage', kind: 'dynamic' }),
    );
  });

  it('api/client.ts imports axios as a package dependency', async () => {
    const { imports } = await parse('api/client.ts');
    expect(imports).toContainEqual(
      expect.objectContaining({ source: 'axios', sourceType: 'package' }),
    );
  });
});
