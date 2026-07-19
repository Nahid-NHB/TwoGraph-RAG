import { ValidationError } from '@twograph/core';
import type { GraphQueries } from '@twograph/graph';
import type { Project } from 'ts-morph';
import type { ZodType } from 'zod';

export interface EditContext {
  repo: string;
  rootPath: string;
  project: Project;
  graphQueries: GraphQueries;
}

export interface EditOperationResult {
  /** Symbol ids the transform touched — the diff itself is computed by the engine, not the operation. */
  affectedSymbols: string[];
}

/**
 * A registered, pluggable edit operation (issue #48, docs/09 §6). Params are
 * validated against `paramsSchema` before `plan()` ever runs; `entryPaths`
 * tells the engine which files to load into the scoped ts-morph project
 * before invoking `plan()`, so an operation only ever needs its own params to
 * describe both "what files do I touch" and "what should change." `plan()`
 * mutates `ctx.project` in memory — the engine diffs the before/after text
 * itself to build the final `EditPlan` (docs/08 §1).
 */
export interface EditOperation<P = unknown> {
  readonly id: string;
  readonly paramsSchema: ZodType<P>;
  /** Repo-relative paths this operation needs loaded, derived from its own params. */
  entryPaths(params: P): string[];
  plan(ctx: EditContext, params: P): EditOperationResult | Promise<EditOperationResult>;
}

/** Registry of edit operations — REST/MCP surfaces enumerate and invoke by `id` (docs/09 §6). */
export class EditOperationRegistry {
  private readonly operations = new Map<string, EditOperation>();

  register<P>(operation: EditOperation<P>): void {
    if (this.operations.has(operation.id)) {
      throw new ValidationError(`edit operation already registered: ${operation.id}`);
    }
    this.operations.set(operation.id, operation);
  }

  /** @throws ValidationError if no operation is registered under this id. */
  get(id: string): EditOperation {
    const operation = this.operations.get(id);
    if (!operation) throw new ValidationError(`unknown edit operation: ${id}`);
    return operation;
  }

  list(): EditOperation[] {
    return [...this.operations.values()];
  }
}
