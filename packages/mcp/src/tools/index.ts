import { semanticSearch } from '@twograph/indexer';
import { runTemplate } from '@twograph/graph';
import type { VectorSearchFilters } from '@twograph/vector';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withRepo } from './shared.js';
import { buildRepositorySummary } from './repository-summary.js';

const repoField = z
  .string()
  .describe('Absolute (or cwd-relative) path to an already-indexed repository root');

function jsonResult(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Registers the M8 read-only MCP tools (issue #63): repository_summary, semantic_search, query_graph. */
export function registerReadTools(server: McpServer): void {
  server.registerTool(
    'repository_summary',
    {
      title: 'Repository summary',
      description:
        'Overview of an already-indexed repository: languages, stacks (dependencies), entry points, and key modules by export count.',
      inputSchema: { repo: repoField },
    },
    async ({ repo }) => jsonResult(await withRepo(repo, (ctx) => buildRepositorySummary(ctx))),
  );

  server.registerTool(
    'semantic_search',
    {
      title: 'Semantic code search',
      description:
        'Hybrid/semantic search over the repository index — ranked symbols with snippets.',
      inputSchema: {
        repo: repoField,
        query: z.string().min(1),
        k: z.number().int().min(1).max(50).optional(),
        kind: z.string().optional().describe('Filter by symbol kind, e.g. Function'),
        pathPrefix: z.string().optional(),
        language: z.string().optional(),
      },
    },
    async ({ repo, query, k, kind, pathPrefix, language }) =>
      jsonResult(
        await withRepo(repo, (ctx) => {
          const filters: VectorSearchFilters = {
            ...(kind ? { kinds: [kind] } : {}),
            ...(pathPrefix ? { pathPrefix } : {}),
            ...(language ? { language } : {}),
          };
          return semanticSearch(ctx, ctx.repo.id, query, k ?? 10, filters);
        }),
      ),
  );

  server.registerTool(
    'query_graph',
    {
      title: 'Query the code graph',
      description:
        "Runs a named, safe Cypher template against the code graph (see the REST API's graph query templates for the available names) and returns matching rows.",
      inputSchema: {
        repo: repoField,
        template: z.string(),
        params: z.record(z.string(), z.unknown()).default({}),
      },
    },
    async ({ repo, template, params }) =>
      jsonResult(
        await withRepo(repo, (ctx) =>
          runTemplate(ctx.graphClient, template, { ...params, repo: ctx.repo.id }),
        ),
      ),
  );
}
