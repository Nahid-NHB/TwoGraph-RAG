import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient } from '@twograph/graph';
import { FtsIndex, MetadataStore, openDatabase } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { Indexer } from '@twograph/indexer';
import { analyzeDependencies } from '@twograph/analysis';

const REPO = 'depstest';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const QDRANT = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

const graphClient = new GraphClient({ uri: MEMGRAPH });
const db = openDatabase(':memory:');
const store = new MetadataStore(db);
const fts = new FtsIndex(db);
const embedder = new MockEmbedder();
const vectors = new QdrantVectorStore({
  url: QDRANT,
  embedderId: 'mock-deps',
  dimensions: embedder.dimensions,
});

let root: string;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-deps-'));
  const fixture = join(import.meta.dirname, '../../../../examples/sample-repo');
  cpSync(join(fixture, 'src'), root, { recursive: true });
  cpSync(join(fixture, 'package.json'), join(root, 'package.json'));
  cpSync(join(fixture, 'tsconfig.json'), join(root, 'tsconfig.json'));
  // An undeclared import — a controlled "phantom dependency" case the fixture doesn't have on its own.
  writeFileSync(join(root, 'extra.ts'), "import _ from 'lodash';\nexport const noop = _.noop;\n");

  const indexer = new Indexer({
    repo: { id: REPO, rootPath: root, name: 'deps-copy' },
    graphClient,
    store,
    fts,
    vectors,
    embedder,
  });
  const result = await indexer.run();
  expect(result.errors).toEqual([]);
}, 60_000);

afterAll(async () => {
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  await vectors.deleteByRepo(REPO);
  await graphClient.close();
  rmSync(root, { recursive: true, force: true });
});

describe('analyzeDependencies (issue #68)', () => {
  it('parses package.json + tsconfig.json and reports declared/used mismatches', async () => {
    const report = await analyzeDependencies(graphClient, REPO, root);

    expect(report.packages).toEqual([expect.objectContaining({ path: '.', name: 'sample-repo' })]);

    expect(report.configurations).toEqual(
      expect.arrayContaining([{ path: 'tsconfig.json', configKind: 'tsconfig' }]),
    );

    const byName = new Map(report.dependencies.map((d) => [d.name, d]));
    for (const used of ['axios', 'express', 'react', 'react-dom', 'react-router-dom']) {
      expect(byName.get(used)).toMatchObject({ declared: true });
      expect(byName.get(used)?.importCount).toBeGreaterThan(0);
      expect(byName.get(used)?.versionRange).toEqual(expect.any(String));
    }
    // lodash is a phantom (imported, never declared) — no package ever
    // DEPENDS_ON'd it, so it has no versionRange and no edge at all.
    expect(byName.get('lodash')?.versionRange).toBeNull();

    const [pkg] = report.packages;
    expect(pkg).toBeDefined();
    const reactEdge = report.edges.find(
      (e) => e.from === pkg!.id && e.to === byName.get('react')!.id,
    );
    expect(reactEdge).toBeDefined();
    expect(reactEdge?.versionRange).toEqual(expect.any(String));
    expect(report.edges.some((e) => e.to === byName.get('lodash')!.id)).toBe(false);

    const mismatchKinds = new Map(report.mismatches.map((m) => [m.name, m.kind]));
    expect(mismatchKinds.get('lodash')).toBe('phantom');
    for (const used of ['axios', 'express', 'react', 'react-dom', 'react-router-dom']) {
      expect(mismatchKinds.has(used)).toBe(false);
    }
    // devDependencies like @types/* and the typescript compiler itself are
    // never `import`ed in source — a known, disclosed limitation of
    // import-based unused-dependency detection, not a false positive here.
    expect(mismatchKinds.get('typescript')).toBe('unused');
  }, 60_000);
});
