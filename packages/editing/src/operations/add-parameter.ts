import { join } from 'node:path';
import { EditError, parseSymbolId } from '@twograph/core';
import { z } from 'zod';
import type { EditContext, EditOperation, EditOperationResult } from '../registry.js';
import { findCallSites, rejectIfOverloaded, resolveTopLevelFunction } from './function-lookup.js';

export const addParameterParamsSchema = z.object({
  symbolId: z.string(),
  name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'must be a valid identifier'),
  type: z.string().min(1),
  /** Source-text expression, e.g. `"3600"` or `"'default'"`. */
  defaultValue: z.string().optional(),
});
export type AddParameterParams = z.infer<typeof addParameterParamsSchema>;

/**
 * Adds a parameter to a top-level function's signature (issue #51, docs/08
 * §2). With a `defaultValue`, the new parameter is optional-with-default in
 * the signature AND every existing call site gets that value appended as an
 * explicit trailing argument, so the change is visible everywhere the
 * function is called. Without one, the parameter is added as optional
 * (`name?: type`) so no existing call site needs to change at all.
 */
export const addParameter: EditOperation<AddParameterParams> = {
  id: 'add_parameter',
  paramsSchema: addParameterParamsSchema,
  entryPaths: (params) => [parseSymbolId(params.symbolId).path],
  plan(ctx: EditContext, params: AddParameterParams): EditOperationResult {
    const { path, qualifiedName } = parseSymbolId(params.symbolId);
    if (qualifiedName.includes('.')) {
      throw new EditError('EDIT_INVALID', 'add_parameter only supports top-level functions');
    }

    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, path));
    const { fn, nameNode } = resolveTopLevelFunction(sourceFile, qualifiedName);
    rejectIfOverloaded(fn, qualifiedName);

    if (fn.getParameters().some((p) => p.getName() === params.name)) {
      throw new EditError(
        'EDIT_INVALID',
        `parameter "${params.name}" already exists on ${qualifiedName}`,
      );
    }

    const callSites = findCallSites(nameNode);

    fn.addParameter({
      name: params.name,
      type: params.type,
      ...(params.defaultValue !== undefined
        ? { initializer: params.defaultValue }
        : { hasQuestionToken: true }),
    });

    if (params.defaultValue !== undefined) {
      for (const call of callSites) call.addArgument(params.defaultValue);
    }

    return { affectedSymbols: [params.symbolId] };
  },
};
