import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { analyzeDependencies, dependencyReportSchema } from '@twograph/analysis';
import type { RepoRegistry } from '../registry.js';

/** `GET /v1/repos/:repo/deps` — manifest/config dependency graph + unused/phantom detection (issue #68). */
export function registerDepsRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/v1/repos/:repo/deps',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        response: { 200: dependencyReportSchema },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      return analyzeDependencies(repo.graphClient, repo.id, repo.rootPath);
    },
  );
}
