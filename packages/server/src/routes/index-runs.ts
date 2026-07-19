import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from '@twograph/core';
import { Indexer } from '@twograph/indexer';
import type { RepoRegistry } from '../registry.js';

const indexBodySchema = z.object({ rebuild: z.boolean().optional() });
const runIdResponseSchema = z.object({ runId: z.string() });
const runStatusSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  kind: z.string(),
  filesAdded: z.number(),
  filesChanged: z.number(),
  filesRemoved: z.number(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});

/** `/v1/repos/:repo/index` — kick off indexing and poll run status (issue #46). */
export function registerIndexRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/v1/repos/:repo/index',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        body: indexBodySchema,
        response: { 202: runIdResponseSchema },
      },
    },
    (request, reply) => {
      const repo = registry.require(request.params.repo);
      const rebuild = request.body.rebuild ?? false;
      const runId = repo.store.startIndexRun(repo.id, rebuild ? 'full' : 'incremental');

      const indexer = new Indexer({
        repo: { id: repo.id, rootPath: repo.rootPath, name: repo.name },
        graphClient: repo.graphClient,
        store: repo.store,
        fts: repo.fts,
        vectors: repo.vectors,
        embedder: repo.embedder,
        ignore: repo.config.index.ignore,
      });
      // Fire-and-forget: the client polls GET .../index/runs/:runId for progress.
      indexer.run({ rebuild, runId }).catch((err: unknown) => {
        app.log.error({ err, repo: repo.id, runId }, 'background index run failed');
      });

      void reply.code(202);
      return { runId };
    },
  );

  server.get(
    '/v1/repos/:repo/index/runs/:runId',
    {
      schema: {
        params: z.object({ repo: z.string(), runId: z.string() }),
        response: { 200: runStatusSchema },
      },
    },
    (request) => {
      const repo = registry.require(request.params.repo);
      const run = repo.store.getIndexRun(request.params.runId);
      if (!run) throw new NotFoundError(`index run not found: ${request.params.runId}`);
      return {
        id: run.id,
        repoId: run.repo_id,
        kind: run.kind,
        filesAdded: run.files_added,
        filesChanged: run.files_changed,
        filesRemoved: run.files_removed,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        error: run.error,
      };
    },
  );
}
