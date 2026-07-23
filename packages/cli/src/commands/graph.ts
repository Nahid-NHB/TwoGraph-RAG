import { GraphError, ValidationError } from '@twograph/core';
import { runTemplate } from '@twograph/graph';
import type { ProgramIo } from '../program.js';
import { openRepoContext, resolveRepoRoot } from '../context.js';

export interface GraphCommandOptions {
  param?: string[];
  json?: boolean;
}

function parseParams(pairs: string[] = []): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) throw new ValidationError(`--param must be key=value, got "${pair}"`);
    params[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return params;
}

/** `twograph graph <template> [--param k=v...]` — runs a named, safe Cypher template (docs/05). */
export async function runGraph(
  cwd: string,
  template: string,
  options: GraphCommandOptions,
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

    const params = parseParams(options.param);
    const rows = await runTemplate(ctx.graphClient, template, { ...params, repo: ctx.repo.id });

    if (options.json) {
      io.out(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      io.out('(no rows)');
      return;
    }
    for (const row of rows) io.out(JSON.stringify(row));
  } finally {
    await ctx.close();
  }
}
