import { analyzeDependencies, findDeadCode } from '@twograph/analysis';
import type { HierarchyEntry } from '@twograph/graph';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withRepo } from './shared.js';

const repoField = z
  .string()
  .describe('Absolute (or cwd-relative) path to an already-indexed repository root');
const depthField = z
  .number()
  .int()
  .min(1)
  .max(5)
  .optional()
  .describe('Traversal depth, 1-5 (default varies by tool)');
const DEFAULT_LIMIT = 50;
const limitField = z
  .number()
  .int()
  .min(1)
  .max(500)
  .optional()
  .describe(
    `Max rows returned per list, sized for LLM consumption (default ${String(DEFAULT_LIMIT)})`,
  );

function jsonResult(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Truncates a list to `limit`, keeping the true count so callers can tell truncation happened. */
function truncate<T>(
  items: T[],
  limit: number,
): { items: T[]; totalCount: number; truncated: boolean } {
  return {
    items: items.slice(0, limit),
    totalCount: items.length,
    truncated: items.length > limit,
  };
}

function truncateHierarchy(entries: HierarchyEntry[], limit: number) {
  return truncate(entries, limit);
}

/**
 * Registers the M8/M9 structural-analysis MCP tools (issue #64):
 * call_hierarchy, component_usage, dependency_graph, dead_code — each
 * delegates to the typed graph query API (issue #28) or the analyzers built
 * for the REST API (issues #67/#68), with depth/limit inputs enforced by the
 * tool's own zod schema and truncated, count-bearing outputs so a single
 * call can't blow an LLM's context budget on a large repo.
 */
export function registerAnalysisTools(server: McpServer): void {
  server.registerTool(
    'call_hierarchy',
    {
      title: 'Call hierarchy',
      description:
        'Upstream (callers) or downstream (callees) call hierarchy for a symbol, up to 5 levels deep.',
      inputSchema: {
        repo: repoField,
        symbolId: z.string(),
        direction: z.enum(['callers', 'callees']).default('callers'),
        depth: depthField,
        limit: limitField,
      },
    },
    async ({ repo, symbolId, direction, depth, limit }) =>
      jsonResult(
        await withRepo(repo, async (ctx) => {
          const entries =
            direction === 'callees'
              ? await ctx.graphQueries.callees(ctx.repo.id, symbolId, depth ?? 2)
              : await ctx.graphQueries.callers(ctx.repo.id, symbolId, depth ?? 2);
          return { symbolId, direction, ...truncateHierarchy(entries, limit ?? DEFAULT_LIMIT) };
        }),
      ),
  );

  server.registerTool(
    'component_usage',
    {
      title: 'Component usage tree',
      description:
        'Which React components (transitively) render a given component, up to 5 levels deep.',
      inputSchema: {
        repo: repoField,
        componentId: z.string(),
        depth: depthField,
        limit: limitField,
      },
    },
    async ({ repo, componentId, depth, limit }) =>
      jsonResult(
        await withRepo(repo, async (ctx) => {
          const entries = await ctx.graphQueries.componentUsage(
            ctx.repo.id,
            componentId,
            depth ?? 3,
          );
          return { componentId, ...truncateHierarchy(entries, limit ?? DEFAULT_LIMIT) };
        }),
      ),
  );

  server.registerTool(
    'dependency_graph',
    {
      title: 'Dependency graph',
      description:
        'Package -> npm dependency graph parsed from package.json/workspaces, plus unused/phantom dependency mismatches.',
      inputSchema: { repo: repoField, limit: limitField },
    },
    async ({ repo, limit }) =>
      jsonResult(
        await withRepo(repo, async (ctx) => {
          const report = await analyzeDependencies(ctx.graphClient, ctx.repo.id, ctx.repo.rootPath);
          const n = limit ?? DEFAULT_LIMIT;
          return {
            packages: report.packages,
            configurations: report.configurations,
            dependencies: truncate(report.dependencies, n),
            edges: truncate(report.edges, n),
            mismatches: truncate(report.mismatches, n),
          };
        }),
      ),
  );

  server.registerTool(
    'dead_code',
    {
      title: 'Dead code report',
      description:
        'Reachability-based dead-code report: unreachable symbols/files from Route/Api entry points (and configured or auto-detected entry files).',
      inputSchema: {
        repo: repoField,
        entry: z.array(z.string()).optional().describe('Entry-point file paths, repo-relative'),
        tests: z
          .boolean()
          .optional()
          .describe('Also treat symbols defined in test files as entry points'),
        limit: limitField,
      },
    },
    async ({ repo, entry, tests, limit }) =>
      jsonResult(
        await withRepo(repo, async (ctx) => {
          const report = await findDeadCode(ctx.graphClient, ctx.repo.id, {
            ...(entry && entry.length > 0 ? { entryPointPaths: entry } : {}),
            includeTests: tests ?? false,
          });
          const n = limit ?? DEFAULT_LIMIT;
          return {
            entryPoints: report.entryPoints,
            symbols: truncate(report.symbols, n),
            files: truncate(report.files, n),
          };
        }),
      ),
  );
}
