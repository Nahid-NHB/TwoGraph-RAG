import { join } from 'node:path';
import { EditError, parseSymbolId } from '@twograph/core';
import type { SourceFile } from 'ts-morph';
import { z } from 'zod';
import type { EditContext, EditOperation, EditOperationResult } from '../registry.js';

export const renameSymbolParamsSchema = z.object({
  symbolId: z.string(),
  newName: z
    .string()
    .min(1)
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'must be a valid JS/TS identifier'),
});
export type RenameSymbolParams = z.infer<typeof renameSymbolParamsSchema>;

/** True if `name` is already bound by a top-level declaration in this file. */
function hasTopLevelBinding(sourceFile: SourceFile, name: string): boolean {
  return (
    sourceFile.getFunction(name) !== undefined ||
    sourceFile.getVariableDeclaration(name) !== undefined ||
    sourceFile.getClass(name) !== undefined ||
    sourceFile.getInterface(name) !== undefined ||
    sourceFile.getTypeAlias(name) !== undefined
  );
}

/** Renames whichever kind of top-level declaration `name` resolves to. */
function renameTopLevelDeclaration(sourceFile: SourceFile, name: string, newName: string): void {
  const fn = sourceFile.getFunction(name);
  if (fn) {
    fn.rename(newName);
    return;
  }
  const variable = sourceFile.getVariableDeclaration(name);
  if (variable) {
    variable.rename(newName);
    return;
  }
  const cls = sourceFile.getClass(name);
  if (cls) {
    cls.rename(newName);
    return;
  }
  throw new EditError(
    'EDIT_INVALID',
    `no top-level function, const, or class named "${name}" in ${sourceFile.getFilePath()}`,
  );
}

/**
 * Type-aware rename of a top-level function, const, or class (issue #50,
 * docs/08 §2). Uses ts-morph's language-service-backed `rename()`, so every
 * loaded reference — call sites, imports, re-exports, and JSX tags — updates
 * consistently; string-literal occurrences are never touched since rename
 * only follows identifier references, not text. Renaming into a name
 * already bound at the top level of the same file is rejected.
 */
export const renameSymbol: EditOperation<RenameSymbolParams> = {
  id: 'rename_symbol',
  paramsSchema: renameSymbolParamsSchema,
  entryPaths: (params) => [parseSymbolId(params.symbolId).path],
  plan(ctx: EditContext, params: RenameSymbolParams): EditOperationResult {
    const { path, qualifiedName } = parseSymbolId(params.symbolId);
    if (qualifiedName.includes('.')) {
      throw new EditError(
        'EDIT_INVALID',
        'rename_symbol only supports top-level functions, consts, and classes, not nested members',
      );
    }

    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, path));
    if (hasTopLevelBinding(sourceFile, params.newName)) {
      throw new EditError(
        'EDIT_INVALID',
        `"${params.newName}" is already declared at the top level of ${path}`,
      );
    }

    renameTopLevelDeclaration(sourceFile, qualifiedName, params.newName);

    return { affectedSymbols: [params.symbolId] };
  },
};
