import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { runTemplate } from '@twograph/graph';
import type { RepoRegistry } from '../registry.js';

const queryBodySchema = z.object({
  template: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
});

const subgraphQuerySchema = z.object({
  root: z.string(),
  /** Comma-separated edge kinds, e.g. "CALLS,IMPORTS". Defaults to the query's own set. */
  edges: z.string().optional(),
  depth: z.coerce.number().int().min(1).max(5).optional(),
});

const nodeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  path: z.string().nullable(),
});
const subgraphResponseSchema = z.object({
  nodes: z.array(nodeSummarySchema),
  edges: z.array(z.object({ from: z.string(), to: z.string(), type: z.string() })),
});

/** `/v1/repos/:repo/graph/{query,subgraph}` — safe templates + visualization data (issue #46). */
export function registerGraphRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/v1/repos/:repo/graph/query',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        body: queryBodySchema,
        response: { 200: z.object({ rows: z.array(z.record(z.string(), z.unknown())) }) },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      const rows = await runTemplate(repo.graphClient, request.body.template, {
        ...request.body.params,
        repo: repo.id,
      });
      return { rows };
    },
  );

  server.get(
    '/v1/repos/:repo/graph/subgraph',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        querystring: subgraphQuerySchema,
        response: { 200: subgraphResponseSchema },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      const edgeTypes = request.query.edges?.split(',').map((s) => s.trim());
      return repo.graphQueries.subgraph(
        repo.id,
        request.query.root,
        edgeTypes,
        request.query.depth,
      );
    },
  );
}
