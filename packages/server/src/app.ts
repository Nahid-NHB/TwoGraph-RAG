import fastifySwagger from '@fastify/swagger';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createLogger } from '@twograph/core';
import { errorHandler } from './errors.js';
import { RepoRegistry } from './registry.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerComponentRoutes } from './routes/components.js';
import { registerFileRoutes } from './routes/files.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerIndexRoutes } from './routes/index-runs.js';
import { registerRepoRoutes } from './routes/repos.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSymbolRoutes } from './routes/symbols.js';

export interface BuildServerOptions {
  registry?: RepoRegistry;
}

/**
 * Builds the Fastify app (issue #46): zod-validated routes for repos,
 * indexing, search, symbols, and graph, RFC 7807 problem+json errors, and an
 * OpenAPI document generated from the same zod schemas at `/openapi.json`.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const registry = options.registry ?? new RepoRegistry();
  // pino's `Logger` type and Fastify's `FastifyBaseLogger` disagree on a few
  // fields (e.g. msgPrefix) under exactOptionalPropertyTypes; both are
  // structurally compatible in practice, so this cast is the standard fix.
  const app = Fastify({
    loggerInstance: createLogger('server') as unknown as FastifyBaseLogger,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  await app.register(fastifySwagger, {
    openapi: { info: { title: 'TwoGraph-RAG API', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });

  registerRepoRoutes(app, registry);
  registerIndexRoutes(app, registry);
  registerSearchRoutes(app, registry);
  registerSymbolRoutes(app, registry);
  registerComponentRoutes(app, registry);
  registerGraphRoutes(app, registry);
  registerFileRoutes(app, registry);
  registerChatRoutes(app, registry);

  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());

  app.addHook('onClose', async () => {
    await registry.closeAll();
  });

  return app;
}
