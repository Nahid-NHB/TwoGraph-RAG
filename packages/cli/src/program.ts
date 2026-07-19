import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runIndex } from './commands/index-repo.js';
import { runQuery } from './commands/query.js';
import { runSearch } from './commands/search.js';

const NOT_IMPLEMENTED: ReadonlyArray<{ name: string; args: string; description: string }> = [
  { name: 'graph', args: '<template>', description: 'Run a graph query template' },
  { name: 'deadcode', args: '', description: 'Report unreachable code from entry points' },
  { name: 'serve', args: '', description: 'Start the REST API server' },
  { name: 'mcp', args: '', description: 'Start the MCP server (stdio)' },
];

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
    .action(async (path: string | undefined, opts: { rebuild?: boolean }) => {
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

  for (const cmd of NOT_IMPLEMENTED) {
    const c = program.command(`${cmd.name} ${cmd.args}`.trim()).description(cmd.description);
    c.allowUnknownOption(true).action(() => {
      io.err(`"twograph ${cmd.name}" is not implemented yet — track progress on GitHub issues.`);
      process.exitCode = 2;
    });
  }

  return program;
}
