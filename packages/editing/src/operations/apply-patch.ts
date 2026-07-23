import { join } from 'node:path';
import { EditError } from '@twograph/core';
import { z } from 'zod';
import type { EditContext, EditOperation, EditOperationResult } from '../registry.js';

export const applyPatchParamsSchema = z.object({
  file: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  newText: z.string(),
});
export type ApplyPatchParams = z.infer<typeof applyPatchParamsSchema>;

/**
 * Replaces an inclusive line range in a file with new text (issue #69) — the
 * generic escape hatch for suggestions that don't map to one of the
 * structured operations (rename/param/extract/etc), still gated by the same
 * propose/approve workflow rather than a direct write.
 */
export const applyPatch: EditOperation<ApplyPatchParams> = {
  id: 'apply_patch',
  paramsSchema: applyPatchParamsSchema,
  entryPaths: (params) => [params.file],
  plan(ctx: EditContext, params: ApplyPatchParams): EditOperationResult {
    if (params.endLine < params.startLine) {
      throw new EditError('EDIT_INVALID', 'endLine must be >= startLine');
    }
    const sourceFile = ctx.project.getSourceFileOrThrow(join(ctx.rootPath, params.file));
    const lines = sourceFile.getFullText().split('\n');
    if (params.endLine > lines.length) {
      throw new EditError(
        'EDIT_INVALID',
        `endLine ${String(params.endLine)} is past the end of the file (${String(lines.length)} lines)`,
      );
    }

    const before = lines.slice(0, params.startLine - 1);
    const after = lines.slice(params.endLine);
    const replacement = params.newText.split('\n');
    sourceFile.replaceWithText([...before, ...replacement, ...after].join('\n'));

    return { affectedSymbols: [] };
  },
};
