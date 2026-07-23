import { GraphError, ValidationError } from '@twograph/core';
import { findDeadCode, type DeadCodeReport } from '@twograph/analysis';
import type { ProgramIo } from '../program.js';
import { openRepoContext, resolveRepoRoot } from '../context.js';

export interface DeadCodeCommandOptions {
  entry?: string[];
  tests?: boolean;
  json?: boolean;
}

function render(report: DeadCodeReport, io: ProgramIo): void {
  if (report.symbols.length === 0 && report.files.length === 0) {
    io.out('no dead code found');
    return;
  }
  for (const file of report.files) {
    io.out(`file  [${file.confidence}]  ${file.path}`);
  }
  for (const symbol of report.symbols) {
    io.out(`${symbol.kind.padEnd(10)}[${symbol.confidence}]  ${symbol.path}  ${symbol.name}`);
  }
}

/** `twograph deadcode [--entry <path>...] [--tests] [--json]` — issue #67. */
export async function runDeadCode(
  cwd: string,
  options: DeadCodeCommandOptions,
  io: ProgramIo,
): Promise<void> {
  const root = resolveRepoRoot(undefined, cwd);
  const ctx = openRepoContext(root);
  try {
    if (!ctx.store.getRepository(ctx.repo.id)) {
      throw new ValidationError(`no index found for ${root} — run "twograph index" first`);
    }
    if (!(await ctx.graphClient.healthcheck())) {
      throw new GraphError(
        'GRAPH_UNAVAILABLE',
        `Memgraph unreachable at ${ctx.config.memgraph.uri}`,
      );
    }

    const report = await findDeadCode(ctx.graphClient, ctx.repo.id, {
      ...(options.entry && options.entry.length > 0 ? { entryPointPaths: options.entry } : {}),
      includeTests: options.tests ?? false,
    });

    if (options.json) {
      io.out(JSON.stringify(report, null, 2));
      return;
    }
    render(report, io);
  } finally {
    await ctx.close();
  }
}
