import { Command } from 'commander';
import { runDeadCode } from './commands/deadcode.js';
import { runDeps } from './commands/deps.js';
import { runGraph } from './commands/graph.js';
import { runInit } from './commands/init.js';
import { runIndex } from './commands/index-repo.js';
import { runMcp } from './commands/mcp.js';
import { runOptimize } from './commands/optimize.js';
import { runQuery } from './commands/query.js';
import { runSearch } from './commands/search.js';
import { runServe } from './commands/serve.js';

export interface ProgramIo {
  out(line: string): void;
  err(line: string): void;
}

export function buildProgram(io: ProgramIo = { out: console.log, err: console.error }): Command {
  const program = new Command('twograph');
  program
    .description('AI-powered code intelligence for JS/TS/React repositories')
    .version('0.0.0', '-V, --version')
    .option('--config <path>', 'path to config file')
    .option('--json', 'machine-readable output')
    .option('--verbose', 'debug logging');

  program
    .command('init')
    .description('Create .twograph/config.json with defaults')
    .option('-f, --force', 'overwrite existing config')
    .action((opts: { force?: boolean }) => {
      const path = runInit(process.cwd(), opts);
      io.out(`Created ${path}`);
    });

  program
    .command('index [path]')
    .description('Index a repository into graph + vector stores')
    .option('--rebuild', 'wipe and rebuild the index from scratch')
    .option('--watch', 'keep watching for changes and reindex incrementally')
    .action(async (path: string | undefined, opts: { rebuild?: boolean; watch?: boolean }) => {
      await runIndex(process.cwd(), path, opts, io);
    });

  program
    .command('search <query>')
    .description('Hybrid/semantic/keyword code search')
    .option('--mode <mode>', 'search mode: semantic, keyword, or hybrid', 'semantic')
    .option('-k <n>', 'number of results', '10')
    .option('--kind <kind>', 'filter by symbol kind')
    .option('--path <prefix>', 'filter by path prefix')
    .action(
      async (query: string, opts: { mode?: string; k?: string; kind?: string; path?: string }) => {
        // --json is declared globally (shared with other commands), not per-command.
        const json = Boolean(program.opts()['json']);
        await runSearch(process.cwd(), query, { ...opts, json }, io);
      },
    );

  program
    .command('query <question>')
    .description('Ask a natural-language question (RAG)')
    .action(async (question: string) => {
      // --json is declared globally (shared with other commands), not per-command.
      const json = Boolean(program.opts()['json']);
      await runQuery(process.cwd(), question, { json }, io);
    });

  program
    .command('mcp')
    .description('Start the MCP server (stdio by default)')
    .option('--http', 'serve streamable HTTP instead of stdio')
    .option('--port <n>', 'HTTP port (default 4802)')
    .action(async (opts: { http?: boolean; port?: string }) => {
      await runMcp(opts, io);
    });

  program
    .command('deadcode')
    .description('Report unreachable code from entry points')
    .option(
      '--entry <path...>',
      'entry-point file paths (repo-relative); defaults to auto-detected',
    )
    .option('--tests', 'also treat symbols defined in test files as entry points')
    .action(async (opts: { entry?: string[]; tests?: boolean }) => {
      const json = Boolean(program.opts()['json']);
      await runDeadCode(process.cwd(), { ...opts, json }, io);
    });

  program
    .command('deps')
    .description('Parse manifests/configs into the graph and report unused/phantom dependencies')
    .action(async () => {
      const json = Boolean(program.opts()['json']);
      await runDeps(process.cwd(), { json }, io);
    });

  program
    .command('optimize <symbolId>')
    .description('Rule-pack + LLM-composed improvement suggestions for a symbol')
    .option('--apply', 'propose the suggested patch (if any) as a pending edit')
    .action(async (symbolId: string, opts: { apply?: boolean }) => {
      const json = Boolean(program.opts()['json']);
      await runOptimize(process.cwd(), symbolId, { ...opts, json }, io);
    });

  program
    .command('serve')
    .description('Start the REST API server (repos register at runtime via POST /v1/repos)')
    .option('--port <n>', 'port to listen on (default: config server.port, else 4801)')
    .action(async (opts: { port?: string }) => {
      await runServe(process.cwd(), opts, io);
    });

  program
    .command('graph <template>')
    .description('Run a named, safe graph query template (see docs/05-graph-schema.md)')
    .option('--param <kv...>', 'template param as key=value (repeatable)')
    .action(async (template: string, opts: { param?: string[] }) => {
      const json = Boolean(program.opts()['json']);
      await runGraph(process.cwd(), template, { ...opts, json }, io);
    });

  return program;
}
