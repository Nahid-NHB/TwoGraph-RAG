import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError, parseSymbolId } from '@twograph/core';
import { advisorReportSchema, runAdvisor } from '@twograph/analysis';
import { proposeEdit } from '@twograph/editing';
import type { RepoRegistry } from '../registry.js';
import { registry as editRegistry } from './edits.js';

const optimizeBodySchema = z.object({ symbolId: z.string(), apply: z.boolean().optional() });
const optimizeResponseSchema = advisorReportSchema.extend({
  editId: z.string().nullable(),
});

/** `POST /v1/repos/:repo/optimize` — rule-pack + LLM suggestions, optionally proposed as a pending edit (issue #69). */
export function registerOptimizeRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/v1/repos/:repo/optimize',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        body: optimizeBodySchema,
        response: { 200: optimizeResponseSchema },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      const { symbolId } = request.body;
      const symbol = repo.store.getSymbol(symbolId);
      if (!symbol) throw new NotFoundError(`symbol not found: ${symbolId}`);
      const { path } = parseSymbolId(symbolId);
      const source = readFileSync(join(repo.rootPath, path), 'utf8')
        .split('\n')
        .slice(symbol.start_line - 1, symbol.end_line)
        .join('\n');

      const report = await runAdvisor(
        repo.llm,
        symbolId,
        path,
        source,
        symbol.start_line,
        repo.rootPath,
        repo.config.guidelinesFile,
      );

      let editId: string | null = null;
      if (request.body.apply && report.suggestedPatch) {
        const edit = await proposeEdit(
          editRegistry,
          {
            store: repo.store,
            repo: repo.id,
            rootPath: repo.rootPath,
            graphQueries: repo.graphQueries,
          },
          report.suggestedPatch.operation,
          report.suggestedPatch.params,
        );
        editId = edit.id;
      }

      return { ...report, editId };
    },
  );
}
