import { GraphError } from '@twograph/core';
import { Indexer, watchRepo, type IndexStage } from '@twograph/indexer';
import type { ProgramIo } from '../program.js';
import { openRepoContext, resolveRepoRoot } from '../context.js';

export interface IndexCommandOptions {
  rebuild?: boolean;
  watch?: boolean;
}

const STAGE_LABELS: Record<IndexStage, string> = {
  discover: 'discovering files',
  parse: 'parsing',
  graph: 'writing graph, store, and search index',
  chunks: 'chunking',
  embed: 'embedding',
  done: 'done',
};

/** `twograph index [path] [--rebuild]` — issue #34/#35. */
export async function runIndex(
  cwd: string,
  path: string | undefined,
  options: IndexCommandOptions,
  io: ProgramIo,
): Promise<void> {
  const root = resolveRepoRoot(path, cwd);
  const ctx = openRepoContext(root);
  try {
    if (!(await ctx.graphClient.healthcheck())) {
      throw new GraphError(
        'GRAPH_UNAVAILABLE',
        `Memgraph unreachable at ${ctx.config.memgraph.uri}`,
      );
    }
    await ctx.vectors.ensureCollection();

    const indexerDeps = {
      repo: ctx.repo,
      graphClient: ctx.graphClient,
      store: ctx.store,
      fts: ctx.fts,
      vectors: ctx.vectors,
      embedder: ctx.embedder,
      ignore: ctx.config.index.ignore,
    };
    let lastStage: IndexStage | undefined;
    const onProgress = (progress: { stage: IndexStage }): void => {
      if (progress.stage === lastStage) return;
      lastStage = progress.stage;
      io.out(`${STAGE_LABELS[progress.stage]}...`);
    };
    const indexer = new Indexer(indexerDeps, onProgress);

    const result = await indexer.run(options.rebuild ? { rebuild: true } : {});
    logRunResult(ctx.repo.name, result, io);

    if (!options.watch) return;

    io.out('watching for changes (ctrl-c to stop)...');
    await new Promise<void>((resolve) => {
      const handle = watchRepo(indexerDeps, onProgress, {
        onRun: (r) => {
          lastStage = undefined;
          logRunResult(ctx.repo.name, r, io);
        },
        onError: (err) => io.err(`watch error: ${String(err)}`),
      });
      process.once('SIGINT', () => {
        void handle.close().then(resolve);
      });
    });
  } finally {
    await ctx.close();
  }
}

function logRunResult(
  repoName: string,
  result: {
    added: number;
    changed: number;
    removed: number;
    embedded: number;
    errors: { path: string; message: string }[];
    durationMs: number;
  },
  io: ProgramIo,
): void {
  io.out(
    `indexed ${repoName}: +${String(result.added)} ~${String(result.changed)} ` +
      `-${String(result.removed)} (${String(result.embedded)} chunks embedded, ` +
      `${String(result.errors.length)} error(s)) in ${String(Math.round(result.durationMs))}ms`,
  );
  for (const err of result.errors) io.err(`  ${err.path}: ${err.message}`);
}
