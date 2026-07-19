import { ValidationError } from '@twograph/core';
import { semanticSearch } from '@twograph/indexer';
import type { VectorSearchFilters } from '@twograph/vector';
import type { ProgramIo } from '../program.js';
import { openRepoContext, resolveRepoRoot } from '../context.js';

export interface SearchCommandOptions {
  mode?: string;
  k?: string;
  kind?: string;
  path?: string;
  json?: boolean;
  /** Repo root override, mainly for testing; defaults to cwd. */
  repo?: string;
}

/** `twograph search <query> [--mode semantic] [-k 10] [--kind fn] [--path dir] [--json]` — issue #35. */
export async function runSearch(
  cwd: string,
  query: string,
  options: SearchCommandOptions,
  io: ProgramIo,
): Promise<void> {
  const mode = options.mode ?? 'semantic';
  if (mode !== 'semantic') {
    throw new ValidationError(
      `search --mode ${mode} is not implemented yet; only "semantic" is available`,
    );
  }

  const root = resolveRepoRoot(options.repo, cwd);
  const ctx = openRepoContext(root);
  try {
    if (!ctx.store.getRepository(ctx.repo.id)) {
      throw new ValidationError(`no index found for ${root} — run "twograph index" first`);
    }

    const filters: VectorSearchFilters = {};
    if (options.kind) filters.kinds = [options.kind];
    if (options.path) filters.pathPrefix = options.path;
    const k = options.k ? Number(options.k) : 10;
    if (!Number.isInteger(k) || k < 1) {
      throw new ValidationError(`-k must be a positive integer, got "${options.k ?? ''}"`);
    }

    const hits = await semanticSearch(ctx, ctx.repo.id, query, k, filters);

    if (options.json) {
      io.out(JSON.stringify(hits, null, 2));
      return;
    }
    if (hits.length === 0) {
      io.out('no results');
      return;
    }
    for (const hit of hits) {
      io.out(`${hit.path}  ${hit.name} (${hit.kind})  score=${hit.score.toFixed(3)}`);
      if (hit.signature) io.out(`    ${hit.signature}`);
      const firstLine = hit.snippet.split('\n')[0];
      if (firstLine) io.out(`    ${firstLine}`);
    }
  } finally {
    await ctx.close();
  }
}
