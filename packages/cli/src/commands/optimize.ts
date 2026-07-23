import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GraphError, NotFoundError, ValidationError } from '@twograph/core';
import { runAdvisor, type AdvisorReport } from '@twograph/analysis';
import { applyPatch, EditOperationRegistry, proposeEdit } from '@twograph/editing';
import { createLlmProvider } from '@twograph/llm';
import type { ProgramIo } from '../program.js';
import { openRepoContext, resolveRepoRoot } from '../context.js';

export interface OptimizeCommandOptions {
  apply?: boolean;
  json?: boolean;
}

const registry = new EditOperationRegistry();
registry.register(applyPatch);

function render(report: AdvisorReport, editId: string | null, io: ProgramIo): void {
  if (report.findings.length === 0) {
    io.out('no rule-pack findings');
  } else {
    io.out('findings:');
    for (const f of report.findings)
      io.out(`  [${f.severity}] ${f.ruleId} (line ${String(f.line)}): ${f.message}`);
  }
  io.out('');
  io.out(report.advice);
  if (report.suggestedPatch) {
    io.out('');
    io.out(
      editId
        ? `proposed edit ${editId} (run "twograph edits approve" via the API/UI)`
        : 'a patch can be proposed with --apply',
    );
  }
}

/** `twograph optimize <symbolId> [--apply] [--json]` — issue #69. */
export async function runOptimize(
  cwd: string,
  symbolId: string,
  options: OptimizeCommandOptions,
  io: ProgramIo,
): Promise<void> {
  const root = resolveRepoRoot(undefined, cwd);
  const ctx = openRepoContext(root);
  try {
    if (!ctx.store.getRepository(ctx.repo.id)) {
      throw new ValidationError(`no index found for ${root} — run "twograph index" first`);
    }
    const symbol = ctx.store.getSymbol(symbolId);
    if (!symbol) throw new NotFoundError(`symbol not found: ${symbolId}`);
    if (!(await ctx.graphClient.healthcheck())) {
      throw new GraphError(
        'GRAPH_UNAVAILABLE',
        `Memgraph unreachable at ${ctx.config.memgraph.uri}`,
      );
    }

    const path = symbolId.slice(symbolId.indexOf(':') + 1, symbolId.indexOf('#'));
    const source = readFileSync(join(root, path), 'utf8')
      .split('\n')
      .slice(symbol.start_line - 1, symbol.end_line)
      .join('\n');

    const llm = createLlmProvider(ctx.config);
    const report = await runAdvisor(
      llm,
      symbolId,
      path,
      source,
      symbol.start_line,
      root,
      ctx.config.guidelinesFile,
    );

    let editId: string | null = null;
    if (options.apply && report.suggestedPatch) {
      const edit = await proposeEdit(
        registry,
        { store: ctx.store, repo: ctx.repo.id, rootPath: root, graphQueries: ctx.graphQueries },
        report.suggestedPatch.operation,
        report.suggestedPatch.params,
      );
      editId = edit.id;
    }

    if (options.json) {
      io.out(JSON.stringify({ ...report, editId }, null, 2));
      return;
    }
    render(report, editId, io);
  } finally {
    await ctx.close();
  }
}
