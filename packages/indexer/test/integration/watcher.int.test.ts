import { cpSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GraphClient } from '@twograph/graph';
import { FtsIndex, MetadataStore, openDatabase } from '@twograph/store';
import { MockEmbedder, QdrantVectorStore } from '@twograph/vector';
import { Indexer, watchRepo, type IndexRunResult, type WatchHandle } from '@twograph/indexer';

const REPO = 'watchtest';
const MEMGRAPH = process.env['MEMGRAPH_URI'] ?? 'bolt://localhost:7687';
const QDRANT = process.env['QDRANT_URL'] ?? 'http://localhost:6333';

const graphClient = new GraphClient({ uri: MEMGRAPH });
const db = openDatabase(':memory:');
const store = new MetadataStore(db);
const fts = new FtsIndex(db);
const embedder = new MockEmbedder();
const vectors = new QdrantVectorStore({
  url: QDRANT,
  embedderId: 'mock-watch',
  dimensions: embedder.dimensions,
});

let root: string;
const deps = {
  repo: { id: REPO, rootPath: '', name: 'watch-copy' },
  graphClient,
  store,
  fts,
  vectors,
  embedder,
};

function waitForRun(runs: IndexRunResult[], countAtLeast: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (runs.length >= countAtLeast) return resolve();
      if (Date.now() > deadline) return reject(new Error('timed out waiting for a watch run'));
      setTimeout(check, 25);
    };
    check();
  });
}

beforeAll(async () => {
  if (!(await graphClient.healthcheck())) throw new Error('Memgraph unreachable');
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  root = mkdtempSync(join(tmpdir(), 'twograph-watch-'));
  cpSync(join(import.meta.dirname, '../../../../examples/sample-repo/src'), root, {
    recursive: true,
  });
  deps.repo.rootPath = root;

  const initial = new Indexer(deps);
  const result = await initial.run();
  expect(result.errors).toEqual([]);
}, 60_000);

afterAll(async () => {
  await graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', { repo: REPO });
  await vectors.deleteByRepo(REPO);
  await graphClient.close();
  rmSync(root, { recursive: true, force: true });
});

describe('watchRepo (issue #66)', () => {
  it('coalesces a burst of rapid saves into one reindex, under 2s', async () => {
    const runs: IndexRunResult[] = [];
    const errors: unknown[] = [];
    const handle: WatchHandle = watchRepo(deps, undefined, {
      debounceMs: 200,
      onRun: (r) => runs.push(r),
      onError: (e) => errors.push(e),
    });

    const target = join(root, 'utils/constants.ts');
    try {
      await handle.ready;
      const started = Date.now();
      for (let i = 0; i < 4; i++) {
        writeFileSync(target, `export const BURST_MARKER = ${String(i)};\n`);
        await new Promise((r) => setTimeout(r, 40)); // well inside the 200ms debounce window
      }
      await waitForRun(runs, 1, 3000);
      const elapsed = Date.now() - started;

      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ changed: 1 });
      expect(elapsed).toBeLessThan(2000);
      expect(errors).toEqual([]);
    } finally {
      await handle.close();
    }
  }, 15_000);

  it('migrates a renamed route-defining file, preserving the Route node instead of leaving an orphan+duplicate', async () => {
    const oldPath = 'api/server.ts';
    const newPath = 'api/server-renamed.ts';
    const oldId = `${REPO}:${oldPath}#GET /api/users`;
    const newId = `${REPO}:${newPath}#GET /api/users`;

    const before = await graphClient.run('MATCH (r:Route {id: $id}) RETURN r.id AS id', {
      id: oldId,
    });
    expect(before).toHaveLength(1); // sanity: the route exists at its original id before the rename

    const runs: IndexRunResult[] = [];
    const errors: unknown[] = [];
    const handle: WatchHandle = watchRepo(deps, undefined, {
      debounceMs: 150,
      onRun: (r) => runs.push(r),
      onError: (e) => errors.push(e),
    });

    try {
      await handle.ready;
      renameSync(join(root, oldPath), join(root, newPath));
      await waitForRun(runs, 1, 5000).catch((err: unknown) => {
        throw errors[0] ?? err;
      });

      const oldNode = await graphClient.run('MATCH (r:Route {id: $id}) RETURN r.id AS id', {
        id: oldId,
      });
      expect(oldNode).toHaveLength(0); // no leftover orphan at the old id

      const newNode = await graphClient.run(
        `MATCH (f:File {id: $fileId})-[:CONTAINS]->(r:Route {id: $id}) RETURN r.id AS id`,
        { id: newId, fileId: `${REPO}:${newPath}` },
      );
      expect(newNode).toHaveLength(1); // exactly one route, owned by the new file

      const duplicates = await graphClient.run(`MATCH (r:Route {id: $id}) RETURN count(r) AS c`, {
        id: newId,
      });
      expect(duplicates[0]?.get('c')).toBe(1); // never both an orphan and a fresh duplicate at once

      const handled = await graphClient.run(
        `MATCH (h)-[:HANDLES]->(r:Route {id: $id}) RETURN h.name AS name`,
        { id: newId },
      );
      expect(handled.map((r) => r.get('name') as string)).toContain('listUsersHandler');
    } finally {
      await handle.close();
    }
  }, 15_000);

  it('recovers from a failed run instead of getting stuck', async () => {
    const runs: IndexRunResult[] = [];
    const errors: unknown[] = [];
    const spy = vi.spyOn(store, 'fileHashes').mockImplementationOnce(() => {
      throw new Error('simulated transient failure');
    });

    const handle: WatchHandle = watchRepo(deps, undefined, {
      debounceMs: 150,
      onRun: (r) => runs.push(r),
      onError: (e) => errors.push(e),
    });

    try {
      await handle.ready;
      writeFileSync(join(root, 'utils/constants.ts'), 'export const RECOVERY_MARKER = 1;\n');
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 3000;
        const check = (): void => {
          if (errors.length > 0) return resolve();
          if (Date.now() > deadline) return reject(new Error('onError never fired'));
          setTimeout(check, 25);
        };
        check();
      });
      expect(runs).toHaveLength(0);

      // The watcher must still be alive: a subsequent real change reindexes normally.
      writeFileSync(join(root, 'utils/constants.ts'), 'export const RECOVERY_MARKER = 2;\n');
      await waitForRun(runs, 1, 3000);
      expect(runs[0]).toMatchObject({ changed: 1 });
    } finally {
      spy.mockRestore();
      await handle.close();
    }
  }, 15_000);
});
