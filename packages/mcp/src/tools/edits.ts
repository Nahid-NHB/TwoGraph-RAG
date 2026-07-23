import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ValidationError } from '@twograph/core';
import {
  addParameter,
  applyPatch,
  approveEdit,
  EditOperationRegistry,
  extractFunction,
  moveFunction,
  proposeEdit,
  removeParameter,
  renameSymbol,
  updateImports,
} from '@twograph/editing';
import { Indexer } from '@twograph/indexer';
import type { RepoContext } from '../context.js';
import { withRepo } from './shared.js';
import { toEditSummary } from './edit-summary.js';
import { suggestImprovements } from './optimize.js';

/** Every built-in edit operation — mirrors `packages/server/src/routes/edits.ts`'s registry. */
const registry = new EditOperationRegistry();
registry.register(renameSymbol);
registry.register(addParameter);
registry.register(removeParameter);
registry.register(moveFunction);
registry.register(extractFunction);
registry.register(updateImports);
registry.register(applyPatch);

/** Re-processes the repo so graph/embeddings reflect an applied edit. */
function reindexer(ctx: RepoContext): () => Promise<void> {
  return async () => {
    const indexer = new Indexer({
      repo: ctx.repo,
      graphClient: ctx.graphClient,
      store: ctx.store,
      fts: ctx.fts,
      vectors: ctx.vectors,
      embedder: ctx.embedder,
      ignore: ctx.config.index.ignore,
    });
    await indexer.run({ rebuild: false });
  };
}

function jsonResult(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Registers the M8 editing tools (issue #65): shares the SQLite edit journal with REST. */
export function registerEditTools(server: McpServer): void {
  server.registerTool(
    'edit_function',
    {
      title: 'Preview or apply a code edit',
      description:
        'Proposes an edit by default (preview: diff + editId, nothing is written). ' +
        'Pass editId and apply:true to apply a previously previewed edit — the same ' +
        'approval gate the REST API and web UI use. Applying without a prior preview is rejected.',
      inputSchema: {
        repo: z.string().describe('Absolute (or cwd-relative) path to an already-indexed repo'),
        operation: z
          .string()
          .optional()
          .describe(
            'Required to preview: rename_symbol, add_parameter, remove_parameter, move_function, extract_function, or update_imports',
          ),
        params: z.record(z.string(), z.unknown()).optional().describe('Required to preview'),
        editId: z.string().optional().describe('Required when apply:true'),
        apply: z.boolean().optional().default(false),
      },
    },
    async ({ repo, operation, params, editId, apply }) => {
      if (apply) {
        if (!editId) {
          throw new ValidationError('apply:true requires an editId from a prior preview call');
        }
        return jsonResult(
          await withRepo(repo, async (ctx) =>
            toEditSummary(
              await approveEdit(
                { store: ctx.store, rootPath: ctx.repo.rootPath, reindex: reindexer(ctx) },
                editId,
              ),
            ),
          ),
        );
      }
      if (!operation || !params) {
        throw new ValidationError('operation and params are required to preview an edit');
      }
      return jsonResult(
        await withRepo(repo, async (ctx) =>
          toEditSummary(
            await proposeEdit(
              registry,
              {
                store: ctx.store,
                repo: ctx.repo.id,
                rootPath: ctx.repo.rootPath,
                graphQueries: ctx.graphQueries,
              },
              operation,
              params,
            ),
          ),
        ),
      );
    },
  );

  server.registerTool(
    'optimize_function',
    {
      title: 'Suggest improvements for a function',
      description:
        "Asks the repo's configured LLM for improvement suggestions on a symbol's current " +
        'source, given optional project guidelines. Returns suggestions as text only — it ' +
        'never proposes an edit on its own.',
      inputSchema: {
        repo: z.string(),
        symbol: z.string().describe('Symbol id, e.g. "<repo>:path/to/file.ts#functionName"'),
        guidelines: z.string().optional(),
      },
    },
    async ({ repo, symbol, guidelines }) =>
      jsonResult(await withRepo(repo, (ctx) => suggestImprovements(ctx, symbol, guidelines))),
  );
}
