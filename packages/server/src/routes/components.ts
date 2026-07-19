import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RepoRegistry } from '../registry.js';

const depthQuerySchema = z.object({ depth: z.coerce.number().int().min(1).max(5).optional() });

const hierarchyEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  path: z.string().nullable(),
  depth: z.number(),
});

/** `/v1/repos/:repo/components/:id/usage` — component usage tree (issue #46). */
export function registerComponentRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/v1/repos/:repo/components/:id/usage',
    {
      schema: {
        params: z.object({ repo: z.string(), id: z.string() }),
        querystring: depthQuerySchema,
        response: { 200: z.array(hierarchyEntrySchema) },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      return repo.graphQueries.componentUsage(repo.id, request.params.id, request.query.depth ?? 3);
    },
  );
}
