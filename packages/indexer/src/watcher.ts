import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { hashContent } from '@twograph/core';
import { GraphWriter } from '@twograph/graph';
import chokidar, { type FSWatcher } from 'chokidar';
import { buildIgnoreMatcher } from './discover.js';
import { Indexer, type IndexerDeps, type IndexProgress, type IndexRunResult } from './pipeline.js';

export interface WatchOptions {
  /** Quiet period after the last file event before a reindex fires (issue #66 burst coalescing). */
  debounceMs?: number;
  onRun?: (result: IndexRunResult) => void;
  onError?: (error: unknown) => void;
}

export interface WatchHandle {
  /** Resolves once the initial directory scan is done and events are reliably delivered. */
  ready: Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Watches a repo root and feeds changes into the incremental indexing
 * pipeline (issue #66): rapid saves coalesce into one debounced reindex,
 * and a detected rename (an add whose content hash matches a just-removed
 * path's stored hash) gets its Route nodes migrated onto the surviving
 * old node afterward, rather than left as a delete+add orphan+duplicate.
 */
export function watchRepo(
  deps: IndexerDeps,
  onProgress?: (p: IndexProgress) => void,
  options: WatchOptions = {},
): WatchHandle {
  const indexer = new Indexer(deps, onProgress);
  const writer = new GraphWriter(deps.graphClient);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const isIgnored = buildIgnoreMatcher(deps.ignore ?? []);

  const pendingAdded = new Set<string>();
  const pendingRemoved = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let rerunQueued = false;

  function toRelPath(absPath: string): string {
    return relative(deps.repo.rootPath, absPath).replaceAll('\\', '/');
  }

  function scheduleRun(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void triggerRun(), debounceMs);
  }

  function detectRenames(
    addedPaths: string[],
    removedPaths: string[],
  ): { oldPath: string; newPath: string }[] {
    if (addedPaths.length === 0 || removedPaths.length === 0) return [];
    const oldHashes = deps.store.fileHashes(deps.repo.id);
    const pairs: { oldPath: string; newPath: string }[] = [];
    for (const removedPath of removedPaths) {
      const oldHash = oldHashes.get(removedPath);
      if (!oldHash) continue;
      for (const addedPath of addedPaths) {
        try {
          const content = readFileSync(join(deps.repo.rootPath, addedPath), 'utf8');
          if (hashContent(content) === oldHash) {
            pairs.push({ oldPath: removedPath, newPath: addedPath });
            break;
          }
        } catch {
          // Added path vanished again before we could read it — not a rename we can act on.
        }
      }
    }
    return pairs;
  }

  async function triggerRun(): Promise<void> {
    if (running) {
      rerunQueued = true;
      return;
    }
    running = true;
    const addedPaths = [...pendingAdded];
    const removedPaths = [...pendingRemoved];
    pendingAdded.clear();
    pendingRemoved.clear();

    try {
      const renames = detectRenames(addedPaths, removedPaths);
      const result = await indexer.run({ kind: 'watch' });
      for (const { oldPath, newPath } of renames) {
        await writer.migrateRenamedRoutes(deps.repo.id, oldPath, newPath);
      }
      options.onRun?.(result);
    } catch (err) {
      options.onError?.(err);
    } finally {
      running = false;
      if (rerunQueued) {
        rerunQueued = false;
        scheduleRun();
      }
    }
  }

  const watcher: FSWatcher = chokidar.watch(deps.repo.rootPath, {
    ignoreInitial: true,
    ignored: (path: string) => isIgnored(toRelPath(path)),
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  watcher.on('add', (path: string) => {
    pendingAdded.add(toRelPath(path));
    scheduleRun();
  });
  watcher.on('change', (path: string) => {
    pendingAdded.add(toRelPath(path));
    scheduleRun();
  });
  watcher.on('unlink', (path: string) => {
    pendingRemoved.add(toRelPath(path));
    scheduleRun();
  });
  // Transient FS errors (e.g. a file vanishing mid-stat) shouldn't kill the
  // watcher — surface them and keep watching.
  watcher.on('error', (err: unknown) => options.onError?.(err));

  const ready = new Promise<void>((resolve) => watcher.once('ready', resolve));

  return {
    ready,
    close: async () => {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}
