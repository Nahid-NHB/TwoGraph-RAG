import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ValidationError } from '@twograph/core';
import { watchRepo } from '@twograph/indexer';
import type { RepoRegistry } from '../registry.js';

const watchBodySchema = z.object({ enabled: z.boolean() });
const watchStatusSchema = z.object({ enabled: z.boolean() });

/** `POST /v1/repos/:repo/watch` — toggle the file watcher for a running server (issue #66). */
export function registerWatchRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/v1/repos/:repo/watch',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        body: watchBodySchema,
        response: { 200: watchStatusSchema },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);

      if (!request.body.enabled) {
        await repo.watchHandle?.close();
        repo.watchHandle = undefined;
        return { enabled: false };
      }

      if (repo.watchHandle) return { enabled: true };

      if (!(await repo.graphClient.healthcheck())) {
        throw new ValidationError(`Memgraph unreachable — cannot start the watcher`);
      }

      repo.watchHandle = watchRepo(
        {
          repo: { id: repo.id, rootPath: repo.rootPath, name: repo.name },
          graphClient: repo.graphClient,
          store: repo.store,
          fts: repo.fts,
          vectors: repo.vectors,
          embedder: repo.embedder,
          ignore: repo.config.index.ignore,
        },
        undefined,
        {
          onError: (err) => app.log.error({ err, repo: repo.id }, 'watch run failed'),
        },
      );
      return { enabled: true };
    },
  );

  server.get(
    '/v1/repos/:repo/watch',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        response: { 200: watchStatusSchema },
      },
    },
    (request) => {
      const repo = registry.require(request.params.repo);
      return { enabled: repo.watchHandle !== undefined };
    },
  );
}
