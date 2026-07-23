import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError } from '@twograph/core';
import {
  addParameter,
  applyPatch,
  approveEdit,
  EditOperationRegistry,
  extractFunction,
  moveFunction,
  proposeEdit,
  rejectEdit,
  removeParameter,
  renameSymbol,
  revertEdit,
  updateImports,
} from '@twograph/editing';
import { Indexer } from '@twograph/indexer';
import type { EditRow } from '@twograph/store';
import type { RegisteredRepo, RepoRegistry } from '../registry.js';

/**
 * Every built-in edit operation — stateless, so one shared registry serves
 * every repo. Exported so other routes (e.g. `optimize.ts`) can propose
 * edits through the same registry instead of building their own.
 */
export const registry = new EditOperationRegistry();
registry.register(renameSymbol);
registry.register(addParameter);
registry.register(removeParameter);
registry.register(moveFunction);
registry.register(extractFunction);
registry.register(updateImports);
registry.register(applyPatch);

const editStatusSchema = z.enum(['pending', 'applied', 'rejected', 'expired', 'reverted']);

const editSummarySchema = z.object({
  id: z.string(),
  repoId: z.string(),
  operation: z.string(),
  status: editStatusSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  diff: z.string(),
  affectedFiles: z.array(z.string()),
  params: z.record(z.string(), z.unknown()),
});

const proposeBodySchema = z.object({
  operation: z.string(),
  params: z.record(z.string(), z.unknown()),
});

function toSummary(row: EditRow): z.infer<typeof editSummarySchema> {
  const fileHashes = JSON.parse(row.file_hashes_json) as Record<string, string>;
  return {
    id: row.id,
    repoId: row.repo_id,
    operation: row.operation,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    diff: row.diff,
    affectedFiles: Object.keys(fileHashes),
    params: JSON.parse(row.params_json) as Record<string, unknown>,
  };
}

/** @throws NotFoundError if the edit doesn't exist or belongs to a different repo. */
function requireEdit(repo: RegisteredRepo, id: string): EditRow {
  const row = repo.store.getEdit(id);
  if (!row || row.repo_id !== repo.id) throw new NotFoundError(`edit not found: ${id}`);
  return row;
}

/** Re-processes the repo so graph/embeddings reflect an applied edit (docs/08 §1 step 6). */
function reindexer(repo: RegisteredRepo): () => Promise<void> {
  return async () => {
    const indexer = new Indexer({
      repo: { id: repo.id, rootPath: repo.rootPath, name: repo.name },
      graphClient: repo.graphClient,
      store: repo.store,
      fts: repo.fts,
      vectors: repo.vectors,
      embedder: repo.embedder,
      ignore: repo.config.index.ignore,
    });
    await indexer.run({ rebuild: false });
  };
}

/**
 * `/v1/repos/:repo/edits[...]` — propose/list/preview/approve/reject/revert
 * over the approval workflow (issue #55, docs/06 §1). Every registered
 * operation from `@twograph/editing` is reachable by its `id` automatically.
 */
export function registerEditRoutes(app: FastifyInstance, repos: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/v1/repos/:repo/edits',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        body: proposeBodySchema,
        response: { 201: editSummarySchema },
      },
    },
    async (request, reply) => {
      const repo = repos.require(request.params.repo);
      const edit = await proposeEdit(
        registry,
        {
          store: repo.store,
          repo: repo.id,
          rootPath: repo.rootPath,
          graphQueries: repo.graphQueries,
        },
        request.body.operation,
        request.body.params,
      );
      void reply.code(201);
      return toSummary(edit);
    },
  );

  server.get(
    '/v1/repos/:repo/edits',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        response: { 200: z.array(editSummarySchema) },
      },
    },
    (request) => {
      const repo = repos.require(request.params.repo);
      return repo.store.listEdits(repo.id).map(toSummary);
    },
  );

  server.get(
    '/v1/repos/:repo/edits/:id',
    {
      schema: {
        params: z.object({ repo: z.string(), id: z.string() }),
        response: { 200: editSummarySchema },
      },
    },
    (request) => {
      const repo = repos.require(request.params.repo);
      return toSummary(requireEdit(repo, request.params.id));
    },
  );

  server.post(
    '/v1/repos/:repo/edits/:id/approve',
    {
      schema: {
        params: z.object({ repo: z.string(), id: z.string() }),
        response: { 200: editSummarySchema },
      },
    },
    async (request) => {
      const repo = repos.require(request.params.repo);
      requireEdit(repo, request.params.id);
      const resolved = await approveEdit(
        { store: repo.store, rootPath: repo.rootPath, reindex: reindexer(repo) },
        request.params.id,
      );
      return toSummary(resolved);
    },
  );

  server.post(
    '/v1/repos/:repo/edits/:id/reject',
    {
      schema: {
        params: z.object({ repo: z.string(), id: z.string() }),
        response: { 200: editSummarySchema },
      },
    },
    (request) => {
      const repo = repos.require(request.params.repo);
      requireEdit(repo, request.params.id);
      return toSummary(rejectEdit(repo.store, request.params.id));
    },
  );

  server.post(
    '/v1/repos/:repo/edits/:id/revert',
    {
      schema: {
        params: z.object({ repo: z.string(), id: z.string() }),
        response: { 200: editSummarySchema },
      },
    },
    (request) => {
      const repo = repos.require(request.params.repo);
      requireEdit(repo, request.params.id);
      return toSummary(revertEdit(repo.store, repo.rootPath, request.params.id));
    },
  );
}
