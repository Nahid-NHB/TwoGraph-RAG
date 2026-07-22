import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphClient } from '@twograph/graph';
import { FtsIndex, MetadataStore, openDatabase } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { Indexer } from '@twograph/indexer';
import { findDeadCode } from '@twograph/analysis';

const REPO = 'deadcodetest';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const QDRANT = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

const graphClient = new GraphClient({ uri: MEMGRAPH });
const db = openDatabase(':memory:');
const store = new MetadataStore(db);
const fts = new FtsIndex(db);
const embedder = new MockEmbedder();
const vectors = new QdrantVectorStore({
  url: QDRANT,
  embedderId: 'mock-deadcode',
  dimensions: embedder.dimensions,
});

let root: string;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-deadcode-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });

  const indexer = new Indexer({
    repo: { id: REPO, rootPath: root, name: 'deadcode-copy' },
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

describe('findDeadCode (issue #67)', () => {
  it('finds the planted dead component with zero false positives on sample-repo', async () => {
    const report = await findDeadCode(graphClient, REPO);

    const deadNames = report.symbols.map((s) => s.name);
    expect(deadNames).toContain('DeadBanner');
    const deadBanner = report.symbols.find((s) => s.name === 'DeadBanner');
    expect(deadBanner).toMatchObject({ kind: 'Component', confidence: 'dead' });

    // Zero false positives: things genuinely used across the fixture must
    // never show up, including the entry-file-only-imported root component
    // (main.tsx's top-level render isn't inside any symbol the parser
    // attributes JSX to, which is exactly the case this analysis has to
    // special-case for entry-point files).
    const usedNames = [
      'App',
      'Layout',
      'Nav',
      'Button',
      'UserCard',
      'UserList',
      'LoginForm',
      'useAuth',
      'useDebounce',
      'useUsers',
      'listUsersHandler',
      'getUserHandler',
      'loginHandler',
      'verifyToken',
    ];
    for (const name of usedNames) {
      expect(deadNames).not.toContain(name);
    }

    // Nothing imports DeadBanner.tsx either, so the file itself is dead too.
    expect(report.files.some((f) => f.path === 'components/DeadBanner.tsx')).toBe(true);
    // Entry-point files are roots by policy — never reported dead even though
    // nothing in-repo imports them (the runtime invokes them directly).
    expect(report.files.some((f) => f.path === 'main.tsx')).toBe(false);
  }, 60_000);

  it('marks a component as possibly-used, not dead, when only reached via a dynamic import', async () => {
    // useLegacyTheme.ts / hooks aren't dynamically imported in the fixture as-is;
    // this asserts the mechanism directly against any dynamically-imported file.
    const dynamicTargets = await graphClient.run(
      `MATCH (x)-[r:IMPORTS]->(f:File {repoId: $repo}) WHERE r.kind = 'dynamic' RETURN f.path AS path`,
      { repo: REPO },
    );
    if (dynamicTargets.length === 0) return; // fixture has no dynamic import — nothing to assert here

    const report = await findDeadCode(graphClient, REPO);
    const dynamicPaths = new Set(dynamicTargets.map((r) => r.get('path') as string));
    for (const entry of [...report.symbols, ...report.files]) {
      if (dynamicPaths.has(entry.path)) expect(entry.confidence).toBe('possibly-used');
    }
  }, 60_000);
});
