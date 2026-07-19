import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError, parseSymbolId } from '@twograph/core';
import type { RepoRegistry } from '../registry.js';

const depthQuerySchema = z.object({ depth: z.coerce.number().int().min(1).max(5).optional() });

const neighborSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  path: z.string().nullable(),
  edge: z.string(),
});

const symbolDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  path: z.string(),
  signature: z.string().nullable(),
  doc: z.string().nullable(),
  startLine: z.number(),
  endLine: z.number(),
  code: z.string(),
  neighbors: z.object({ outgoing: z.array(neighborSchema), incoming: z.array(neighborSchema) }),
});

const hierarchyEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  path: z.string().nullable(),
  depth: z.number(),
});

/** `/v1/repos/:repo/symbols/:id[/callers|/callees]` — issue #46. */
export function registerSymbolRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/v1/repos/:repo/symbols/:id',
    {
      schema: {
        params: z.object({ repo: z.string(), id: z.string() }),
        response: { 200: symbolDetailSchema },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      const symbolId = request.params.id;
      const symbol = repo.store.getSymbol(symbolId);
      if (!symbol) throw new NotFoundError(`symbol not found: ${symbolId}`);
      const { path } = parseSymbolId(symbolId);
      const code = readFileSync(join(repo.rootPath, path), 'utf8')
        .split('\n')
        .slice(symbol.start_line - 1, symbol.end_line)
        .join('\n');
      const neighbors = await repo.graphQueries.neighbors(repo.id, symbolId);
      return {
        id: symbol.id,
        name: symbol.name,
        kind: symbol.kind,
        path,
        signature: symbol.signature,
        doc: symbol.doc,
        startLine: symbol.start_line,
        endLine: symbol.end_line,
        code,
        neighbors,
      };
    },
  );

  server.get(
    '/v1/repos/:repo/symbols/:id/callers',
    {
      schema: {
        params: z.object({ repo: z.string(), id: z.string() }),
        querystring: depthQuerySchema,
        response: { 200: z.array(hierarchyEntrySchema) },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      return repo.graphQueries.callers(repo.id, request.params.id, request.query.depth ?? 2);
    },
  );

  server.get(
    '/v1/repos/:repo/symbols/:id/callees',
    {
      schema: {
        params: z.object({ repo: z.string(), id: z.string() }),
        querystring: depthQuerySchema,
        response: { 200: z.array(hierarchyEntrySchema) },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      return repo.graphQueries.callees(repo.id, request.params.id, request.query.depth ?? 2);
    },
  );
}
