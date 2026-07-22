#!/usr/bin/env node
import { DEFAULT_HTTP_PORT, startHttpServer, startStdioServer } from './runtime.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes('--http')) {
    await startStdioServer();
    return;
  }
  const portFlagIndex = args.indexOf('--port');
  const portArg = portFlagIndex !== -1 ? args[portFlagIndex + 1] : undefined;
  await startHttpServer(portArg ? Number(portArg) : DEFAULT_HTTP_PORT);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exitCode = 1;
});
