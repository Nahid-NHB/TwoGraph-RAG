import type { GraphQueries } from '@twograph/graph';
import { assertProjectParsesCleanly } from './diagnostics.js';
import { buildEditPlan, snapshotProject, type EditPlan } from './plan.js';
import { type EditContext, type EditOperationRegistry } from './registry.js';
import { loadScopedProject } from './project.js';

export interface PlanEditDeps {
  repo: string;
  rootPath: string;
  graphQueries: GraphQueries;
}

/**
 * The editing engine (issue #48, docs/08 §1 steps 1-3): validates params,
 * loads a scoped ts-morph project from the graph's import edges, runs the
 * operation's in-memory transform, rejects broken output, and returns a diff
 * preview. Nothing is written to disk — that's the approval workflow
 * (issue #49).
 */
export async function planEdit(
  registry: EditOperationRegistry,
  deps: PlanEditDeps,
  operationId: string,
  rawParams: unknown,
): Promise<EditPlan> {
  const operation = registry.get(operationId);
  const params = operation.paramsSchema.parse(rawParams);
  const entryPaths = operation.entryPaths(params);

  const project = await loadScopedProject(deps.rootPath, deps.graphQueries, deps.repo, entryPaths);
  const before = snapshotProject(project, deps.rootPath);

  const ctx: EditContext = {
    repo: deps.repo,
    rootPath: deps.rootPath,
    project,
    graphQueries: deps.graphQueries,
  };
  const result = await operation.plan(ctx, params);

  assertProjectParsesCleanly(project);

  return buildEditPlan(operation.id, project, deps.rootPath, before, result.affectedSymbols);
}
