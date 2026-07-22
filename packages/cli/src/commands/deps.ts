import { GraphError, ValidationError } from '@twograph/core';
import { analyzeDependencies, type DependencyReport } from '@twograph/analysis';
import type { ProgramIo } from '../program.js';
import { openRepoContext, resolveRepoRoot } from '../context.js';

export interface DepsCommandOptions {
  json?: boolean;
}

function render(report: DependencyReport, io: ProgramIo): void {
  io.out(
    `${String(report.packages.length)} package(s), ${String(report.dependencies.length)} dependencies:`,
  );
  for (const dep of report.dependencies) {
    io.out(
      `  ${dep.name.padEnd(30)} ${(dep.depKind ?? '?').padEnd(8)} imports=${String(dep.importCount)}`,
    );
  }
  if (report.configurations.length > 0) {
    io.out('configs:');
    for (const config of report.configurations) io.out(`  [${config.configKind}] ${config.path}`);
  }
  if (report.mismatches.length > 0) {
    io.out('mismatches:');
    for (const m of report.mismatches) io.out(`  [${m.kind}] ${m.name}`);
  }
}

/** `twograph deps [--json]` — issue #68: manifests/configs into the graph, plus unused/phantom detection. */
export async function runDeps(
  cwd: string,
  options: DepsCommandOptions,
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

    const report = await analyzeDependencies(ctx.graphClient, ctx.repo.id, root);

    if (options.json) {
      io.out(JSON.stringify(report, null, 2));
      return;
    }
    render(report, io);
  } finally {
    await ctx.close();
  }
}
