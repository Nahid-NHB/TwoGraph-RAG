import { DEFAULT_HTTP_PORT, startHttpServer, startStdioServer } from '@twograph/mcp';
import type { ProgramIo } from '../program.js';

export interface McpCommandOptions {
  http?: boolean;
  port?: string;
}

/** `twograph mcp [--http] [--port <n>]` — issue #63. */
export async function runMcp(options: McpCommandOptions, io: ProgramIo): Promise<void> {
  if (!options.http) {
    await startStdioServer();
    return;
  }
  const port = options.port ? Number(options.port) : DEFAULT_HTTP_PORT;
  if (!Number.isInteger(port) || port < 1) {
    io.err(`--port must be a positive integer, got "${options.port ?? ''}"`);
    process.exitCode = 2;
    return;
  }
  await startHttpServer(port);
}
