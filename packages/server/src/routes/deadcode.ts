import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { findDeadCode, deadCodeReportSchema } from '@twograph/analysis';
import type { RepoRegistry } from '../registry.js';

const deadCodeQuerySchema = z.object({
  entry: z.string().optional(),
  tests: z.coerce.boolean().optional(),
});

/** `GET /v1/repos/:repo/deadcode` — reachability-based dead-code report (issue #67). */
export function registerDeadCodeRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/v1/repos/:repo/deadcode',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        querystring: deadCodeQuerySchema,
        response: { 200: deadCodeReportSchema },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      const entryPointPaths = request.query.entry
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return findDeadCode(repo.graphClient, repo.id, {
        ...(entryPointPaths && entryPointPaths.length > 0 ? { entryPointPaths } : {}),
        includeTests: request.query.tests ?? false,
      });
    },
  );
}
