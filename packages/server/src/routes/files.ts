import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { formatFileId } from '@twograph/core';
import type { RepoRegistry } from '../registry.js';

const fileSymbolSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  signature: z.string().nullable(),
  startLine: z.number(),
  endLine: z.number(),
  exported: z.boolean(),
});

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  /** Always present (empty for files) — keeps the recursive zod schema simple. */
  children: FileTreeNode[];
}

// A truly recursive `z.lazy()` schema here produces a `$ref` cycle that the
// OpenAPI generator (fastify-swagger's zod transform) can't resolve — it
// emits a dangling `$ref` with no matching `components.schemas` entry, which
// crashes `openapi-typescript` client generation. `children` is left as
// `unknown[]` at the validation/doc layer (still passed through unmodified,
// since zod's `unknown` doesn't reshape values); `FileTreeNode` above is the
// real, fully-recursive TypeScript type the route handler actually returns.
const fileTreeNodeSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'directory']),
  children: z.array(z.unknown()),
});

/** Builds a nested tree from flat repo-relative POSIX paths, dirs sorted before files. */
export function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', path: '', type: 'directory', children: [] };
  for (const path of paths) {
    const segments = path.split('/');
    let node = root;
    let currentPath = '';
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isFile = i === segments.length - 1;
      let child = node.children.find((c) => c.name === segment);
      if (!child) {
        child = {
          name: segment,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
  }
  const sortTree = (node: FileTreeNode): void => {
    node.children.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
    );
    for (const child of node.children) sortTree(child);
  };
  sortTree(root);
  return root.children;
}

/** `/v1/repos/:repo/files/tree` — repository explorer tree (issue #46). */
export function registerFileRoutes(app: FastifyInstance, registry: RepoRegistry): void {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/v1/repos/:repo/files/tree',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        response: { 200: z.object({ tree: z.array(fileTreeNodeSchema) }) },
      },
    },
    async (request) => {
      const repo = registry.require(request.params.repo);
      const paths = await repo.graphQueries.filePaths(repo.id);
      return { tree: buildFileTree(paths) };
    },
  );

  server.get(
    '/v1/repos/:repo/files/symbols',
    {
      schema: {
        params: z.object({ repo: z.string() }),
        querystring: z.object({ path: z.string().min(1) }),
        response: { 200: z.object({ symbols: z.array(fileSymbolSchema) }) },
      },
    },
    (request) => {
      const repo = registry.require(request.params.repo);
      const fileId = formatFileId({ repo: repo.id, path: request.query.path });
      const symbols = repo.store.symbolsByFile(fileId).map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        signature: s.signature,
        startLine: s.start_line,
        endLine: s.end_line,
        exported: s.exported !== 0,
      }));
      return { symbols };
    },
  );
}
