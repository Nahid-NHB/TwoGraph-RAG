import { GraphError } from '@twograph/core';
import { Indexer, type IndexStage } from '@twograph/indexer';
import type { ProgramIo } from '../program.js';
import { openRepoContext, resolveRepoRoot } from '../context.js';

export interface IndexCommandOptions {
  rebuild?: boolean;
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

    let lastStage: IndexStage | undefined;
    const indexer = new Indexer(
      {
        repo: ctx.repo,
        graphClient: ctx.graphClient,
        store: ctx.store,
        fts: ctx.fts,
        vectors: ctx.vectors,
        embedder: ctx.embedder,
        ignore: ctx.config.index.ignore,
      },
      (progress) => {
        if (progress.stage === lastStage) return;
        lastStage = progress.stage;
        io.out(`${STAGE_LABELS[progress.stage]}...`);
      },
    );

    const result = await indexer.run(options.rebuild ? { rebuild: true } : {});
    io.out(
      `indexed ${ctx.repo.name}: +${String(result.added)} ~${String(result.changed)} ` +
        `-${String(result.removed)} (${String(result.embedded)} chunks embedded, ` +
        `${String(result.errors.length)} error(s)) in ${String(Math.round(result.durationMs))}ms`,
    );
    for (const err of result.errors) io.err(`  ${err.path}: ${err.message}`);
  } finally {
    await ctx.close();
  }
}
