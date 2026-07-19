import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatSymbolId, type ParsedFile } from '@twograph/core';
import { addParameter, EditOperationRegistry, planEdit, removeParameter } from '@twograph/editing';
import { bootstrapSchema, GraphClient, GraphQueries, GraphWriter } from '@twograph/graph';
import { createModuleResolver, ParserEngine, resolveReferences } from '@twograph/parser';

const REPO = 'signature-edits-int-test';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';

const graphClient = new GraphClient({ uri: MEMGRAPH });
const graphQueries = new GraphQueries(graphClient);
const writer = new GraphWriter(graphClient);
const engine = new ParserEngine();

let root: string;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  root = mkdtempSync(join(tmpdir(), 'twograph-sig-edit-int-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });

  await bootstrapSchema(graphClient);
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });

  const files: ParsedFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) await walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) {
        files.push(await engine.parseFile(REPO, relative(root, full), readFileSync(full, 'utf8')));
      }
    }
  };
  await walk(root);
  resolveReferences(files);
  const resolver = createModuleResolver(files.map((f) => f.path));
  await writer.ensureRepository({ id: REPO, name: 'sig-edit', rootPath: root });
  for (const f of files) await writer.writeParsedFile(f);
  for (const f of files) await writer.writeStructuralEdges(f, resolver);
}, 120_000);

afterAll(async () => {
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  await graphClient.close();
  rmSync(root, { recursive: true, force: true });
});

describe('add_parameter / remove_parameter end-to-end on the sample repo', () => {
  it('adds a parameter to signToken and updates every real call site across files', async () => {
    const registry = new EditOperationRegistry();
    registry.register(addParameter);

    const plan = await planEdit(
      registry,
      { repo: REPO, rootPath: root, graphQueries },
      'add_parameter',
      {
        symbolId: formatSymbolId({ repo: REPO, path: 'auth/jwt.ts', qualifiedName: 'signToken' }),
        name: 'issuer',
        type: 'string',
        defaultValue: "'twograph'",
      },
    );

    expect(plan.affectedFiles).toContain('auth/jwt.ts');
    expect(plan.affectedFiles.length).toBeGreaterThan(1);
    expect(plan.fileContents['auth/jwt.ts']).toContain("issuer: string = 'twograph'");
    for (const path of plan.affectedFiles.filter((p) => p !== 'auth/jwt.ts')) {
      expect(plan.fileContents[path]).toContain("'twograph'");
    }
  });

  it('removes an unused parameter from a real function with no callers needing updates', async () => {
    // toCsvRow is intentionally dead code in the fixture — safe, isolated target.
    const original = readFileSync(join(root, 'utils/format.ts'), 'utf8');
    expect(original).toContain('export function toCsvRow(values: string[])');

    const registry = new EditOperationRegistry();
    registry.register(removeParameter);

    const plan = await planEdit(
      registry,
      { repo: REPO, rootPath: root, graphQueries },
      'remove_parameter',
      {
        symbolId: formatSymbolId({
          repo: REPO,
          path: 'utils/format.ts',
          qualifiedName: 'toCsvRow',
        }),
        paramName: 'values',
        force: true,
      },
    );

    expect(plan.affectedFiles).toEqual(['utils/format.ts']);
    expect(plan.fileContents['utils/format.ts']).toContain('export function toCsvRow()');
  });
});
