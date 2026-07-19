import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RepoRow } from '@twograph/store';
import type { RepoRegistry } from '../registry.js';

const registerBodySchema = z.object({
  rootPath: z.string().min(1),
  name: z.string().min(1).optional(),
});

const repoSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  createdAt: z.string(),
  lastIndexed: z.string().nullable(),
});

function toSummary(row: RepoRow): z.infer<typeof repoSummarySchema> {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    createdAt: row.created_at,
    lastIndexed: row.last_indexed,
  };
}

/** `/v1/repos` — register, list, and fetch repos (issue #46, docs/06 §1). */
export function registerRepoRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/v1/repos',
    { schema: { body: registerBodySchema, response: { 201: repoSummarySchema } } },
    (request, reply) => {
      const repo = registry.register(request.body.rootPath, request.body.name);
      void reply.code(201);
      return toSummary(repo.store.getRepository(repo.id)!);
    },
  );

  server.get('/v1/repos', { schema: { response: { 200: z.array(repoSummarySchema) } } }, () =>
    registry.list().map((repo) => toSummary(repo.store.getRepository(repo.id)!)),
  );

  server.get(
    '/v1/repos/:repo',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        response: { 200: repoSummarySchema },
      },
    },
    (request) => {
      const repo = registry.require(request.params.repo);
      return toSummary(repo.store.getRepository(repo.id)!);
    },
  );
}
