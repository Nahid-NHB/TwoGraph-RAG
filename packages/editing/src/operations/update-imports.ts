import { join } from 'node:path';
import { z } from 'zod';
import type { EditContext, EditOperation, EditOperationResult } from '../registry.js';
import { addNamedImport } from './imports.js';

const addImportSchema = z.object({
  moduleSpecifier: z.string().min(1),
  namedImports: z.array(z.string()).optional(),
  defaultImport: z.string().optional(),
  isTypeOnly: z.boolean().optional(),
});

const removeImportSchema = z.object({
  moduleSpecifier: z.string().min(1),
  /** Omit to drop the whole import statement; otherwise only these named specifiers are removed. */
  namedImports: z.array(z.string()).optional(),
});

export const updateImportsParamsSchema = z.object({
  file: z.string().min(1),
  add: z.array(addImportSchema).optional(),
  remove: z.array(removeImportSchema).optional(),
  /** Sorts, merges duplicate module specifiers, and drops unused imports (never side-effect-only ones). */
  organize: z.boolean().optional(),
});
export type UpdateImportsParams = z.infer<typeof updateImportsParamsSchema>;

/**
 * Standalone import management (issue #54, docs/08 §2), and the finishing
 * pass other operations reuse (`addNamedImport`, shared with move_function):
 * add (deduped into an existing statement from the same module), remove
 * (a whole statement or just some named specifiers), and organize (ts-morph's
 * own `organizeImports` — sorts, coalesces duplicate module specifiers, and
 * drops anything left unused; side-effect-only imports have no specifiers to
 * check usage of, so it never touches them).
 */
export const updateImports: EditOperation<UpdateImportsParams> = {
  id: 'update_imports',
  paramsSchema: updateImportsParamsSchema,
  entryPaths: (params) => [params.file],
  plan(ctx: EditContext, params: UpdateImportsParams): EditOperationResult {
    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, params.file));

    for (const spec of params.add ?? []) {
      const existing = sourceFile
        .getImportDeclarations()
        .find(
          (d) =>
            d.getModuleSpecifierValue() === spec.moduleSpecifier &&
            d.isTypeOnly() === (spec.isTypeOnly ?? false),
        );
      if (spec.defaultImport && !existing?.getDefaultImport()) {
        if (existing) {
          existing.setDefaultImport(spec.defaultImport);
        } else {
          sourceFile.addImportDeclaration({
            moduleSpecifier: spec.moduleSpecifier,
            defaultImport: spec.defaultImport,
            ...(spec.isTypeOnly ? { isTypeOnly: true } : {}),
          });
        }
      }
      for (const name of spec.namedImports ?? []) {
        addNamedImport(sourceFile, spec.moduleSpecifier, name, spec.isTypeOnly ?? false);
      }
    }

    for (const spec of params.remove ?? []) {
      const decl = sourceFile
        .getImportDeclarations()
        .find((d) => d.getModuleSpecifierValue() === spec.moduleSpecifier);
      if (!decl) continue; // nothing to remove — a no-op, not an error

      if (!spec.namedImports || spec.namedImports.length === 0) {
        decl.remove();
        continue;
      }
      for (const name of spec.namedImports) {
        decl
          .getNamedImports()
          .find((ni) => ni.getName() === name)
          ?.remove();
      }
      if (
        decl.getNamedImports().length === 0 &&
        !decl.getDefaultImport() &&
        !decl.getNamespaceImport()
      ) {
        decl.remove();
      }
    }

    if (params.organize) {
      sourceFile.organizeImports();
    }

    return { affectedSymbols: [] };
  },
};
