import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatSymbolId } from '@twograph/core';
import { approveEdit, EditOperationRegistry, proposeEdit, renameSymbol } from '@twograph/editing';
import { GraphClient, GraphQueries } from '@twograph/graph';
import { Indexer } from '@twograph/indexer';
import { FtsIndex, MetadataStore, openDatabase } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';

const REPO = 'rename-symbol-int-test';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const QDRANT = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

const graphClient = new GraphClient({ uri: MEMGRAPH });
const graphQueries = new GraphQueries(graphClient);
const db = openDatabase(':memory:');
const store = new MetadataStore(db);
const fts = new FtsIndex(db);
const embedder = new MockEmbedder();
const vectors = new QdrantVectorStore({
  url: QDRANT,
  embedderId: 'mock-rename',
  dimensions: embedder.dimensions,
});

let root: string;
let indexer: Indexer;

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-rename-int-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  indexer = new Indexer({
    repo: { id: REPO, rootPath: root, name: 'rename-copy' },
    graphClient,
    store,
    fts,
    vectors,
    embedder,
  });
  store.upsertRepository({ id: REPO, rootPath: root, name: 'rename-copy' });
  await indexer.run();
}, 120_000);

afterAll(async () => {
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  await vectors.deleteByRepo(REPO);
  await graphClient.close();
  rmSync(root, { recursive: true, force: true });
});

describe('rename_symbol end-to-end (propose -> approve -> reindex)', () => {
  it('updates the JSX call site and the graph reflects the new name', async () => {
    const registry = new EditOperationRegistry();
    registry.register(renameSymbol);

    const edit = await proposeEdit(
      registry,
      { store, repo: REPO, rootPath: root, graphQueries },
      'rename_symbol',
      {
        symbolId: formatSymbolId({
          repo: REPO,
          path: 'components/UserCard.tsx',
          qualifiedName: 'UserCard',
        }),
        newName: 'UserProfileCard',
      },
    );

    expect(edit.diff).toContain('-export function UserCard(');

    const resolved = await approveEdit(
      {
        store,
        rootPath: root,
        reindex: () => indexer.run({ rebuild: false }).then(() => undefined),
      },
      edit.id,
    );
    expect(resolved.status).toBe('applied');

    // Declaration file updated on disk.
    const cardText = readFileSync(join(root, 'components/UserCard.tsx'), 'utf8');
    expect(cardText).toContain('export function UserProfileCard(');

    // JSX call site updated on disk.
    const listText = readFileSync(join(root, 'components/UserList.tsx'), 'utf8');
    expect(listText).toContain('<UserProfileCard');
    expect(listText).not.toContain('<UserCard ');

    // The graph reflects the new name after the triggered reindex.
    const renamed = await graphQueries.findByName(REPO, 'UserProfileCard');
    expect(renamed.length).toBeGreaterThan(0);
    const stale = await graphQueries.findByName(REPO, 'UserCard');
    expect(stale).toEqual([]);
  }, 60_000);
});
