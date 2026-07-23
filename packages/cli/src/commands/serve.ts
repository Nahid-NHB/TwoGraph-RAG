import { loadConfig } from '@twograph/core';
import { buildServer } from '@twograph/server';
import type { ProgramIo } from '../program.js';

export interface ServeCommandOptions {
  port?: string;
}

/**
 * `twograph serve` — starts the REST API with an empty repo registry.
 * Repos are registered at runtime via `POST /v1/repos {rootPath}` (the web
 * UI's own RepoGate does exactly this), so no repo path argument is needed
 * here; this only decides which port to listen on.
 */
export async function runServe(
  cwd: string,
  options: ServeCommandOptions,
  io: ProgramIo,
): Promise<void> {
  const config = loadConfig({ cwd });
  const port = options.port ? Number(options.port) : config.server.port;

  const app = await buildServer();
  await app.listen({ port, host: '127.0.0.1' });
  io.out(`TwoGraph-RAG server listening at http://127.0.0.1:${String(port)}`);
  io.out(`OpenAPI document: http://127.0.0.1:${String(port)}/openapi.json`);
  io.out('Register a repo: POST /v1/repos {"rootPath": "/absolute/path/to/repo"}');

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void app.close().then(resolve);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
