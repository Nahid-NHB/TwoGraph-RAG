import { join } from 'node:path';
import { EditError, parseSymbolId } from '@twograph/core';
import { Node, type ParameterDeclaration } from 'ts-morph';
import { z } from 'zod';
import type { EditContext, EditOperation, EditOperationResult } from '../registry.js';
import {
  findCallSites,
  rejectIfOverloaded,
  resolveTopLevelFunction,
  type FunctionLike,
} from './function-lookup.js';

export const removeParameterParamsSchema = z.object({
  symbolId: z.string(),
  paramName: z.string(),
  /** Removes the parameter even if it's referenced in the function body. */
  force: z.boolean().optional(),
});
export type RemoveParameterParams = z.infer<typeof removeParameterParamsSchema>;

/** True if `param`'s binding is referenced anywhere inside `fn`'s body. */
function isUsedInBody(fn: FunctionLike, param: ParameterDeclaration): boolean {
  const body = fn.getBody();
  if (!body) return false;
  const nameNode = param.getNameNode();
  // A destructured binding pattern (`{a, b}: Props`) can't be reference-checked
  // the same way — treat it as used so `force` is required to remove it.
  if (!Node.isIdentifier(nameNode)) return true;

  const bodyStart = body.getPos();
  const bodyEnd = body.getEnd();
  return nameNode
    .findReferencesAsNodes()
    .some((ref) => ref !== nameNode && ref.getPos() >= bodyStart && ref.getEnd() <= bodyEnd);
}

/**
 * Removes a parameter from a top-level function's signature (issue #51,
 * docs/08 §2). Rejected when the parameter is referenced in the function
 * body unless `force` is set; every existing call site has its
 * corresponding positional argument pruned in the same plan.
 */
export const removeParameter: EditOperation<RemoveParameterParams> = {
  id: 'remove_parameter',
  paramsSchema: removeParameterParamsSchema,
  entryPaths: (params) => [parseSymbolId(params.symbolId).path],
  plan(ctx: EditContext, params: RemoveParameterParams): EditOperationResult {
    const { path, qualifiedName } = parseSymbolId(params.symbolId);
    if (qualifiedName.includes('.')) {
      throw new EditError('EDIT_INVALID', 'remove_parameter only supports top-level functions');
    }

    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, path));
    const { fn, nameNode } = resolveTopLevelFunction(sourceFile, qualifiedName);
    rejectIfOverloaded(fn, qualifiedName);

    const parameters = fn.getParameters();
    const index = parameters.findIndex((p) => p.getName() === params.paramName);
    if (index === -1) {
      throw new EditError(
        'EDIT_INVALID',
        `no parameter named "${params.paramName}" on ${qualifiedName}`,
      );
    }
    const param = parameters[index]!;

    if (!params.force && isUsedInBody(fn, param)) {
      throw new EditError(
        'EDIT_INVALID',
        `parameter "${params.paramName}" is used in the function body — pass force to remove it anyway`,
      );
    }

    const callSites = findCallSites(nameNode);
    param.remove();
    for (const call of callSites) {
      const args = call.getArguments();
      const arg = args[index];
      if (arg) call.removeArgument(arg);
    }

    return { affectedSymbols: [params.symbolId] };
  },
};
