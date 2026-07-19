import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RepoRegistry } from '../registry.js';

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  /** Always present (empty for files) — keeps the recursive zod schema simple. */
  children: FileTreeNode[];
}

const fileTreeNodeSchema: z.ZodType<FileTreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'directory']),
    children: z.array(fileTreeNodeSchema),
  }),
);

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
}
