import { useQuery } from '@tanstack/react-query';
import type { FileTreeNode } from '@twograph/server';
import { api, apiError } from './client.js';

/** All repos registered on this server — powers the sidebar's repo switcher. */
export function useRepos() {
  return useQuery({
    queryKey: ['repos'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos');
      if (error) throw apiError(error);
      return data;
    },
  });
}

export function useRepo(repoId: string | undefined) {
  return useQuery({
    queryKey: ['repos', repoId],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos/{repo}', {
        params: { path: { repo: repoId! } },
      });
      if (error) throw apiError(error);
      return data;
    },
    enabled: Boolean(repoId),
  });
}

export function useFileTree(repoId: string | undefined) {
  return useQuery({
    queryKey: ['files', 'tree', repoId],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos/{repo}/files/tree', {
        params: { path: { repo: repoId! } },
      });
      if (error) throw apiError(error);
      // The OpenAPI schema can't express a truly recursive shape (see
      // files.ts on the server) — `FileTreeNode` is the real, hand-verified
      // type the route always returns.
      return data.tree as FileTreeNode[];
    },
    enabled: Boolean(repoId),
  });
}

export function useFileSymbols(repoId: string | undefined, path: string | undefined) {
  return useQuery({
    queryKey: ['files', 'symbols', repoId, path],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos/{repo}/files/symbols', {
        params: { path: { repo: repoId! }, query: { path: path! } },
      });
      if (error) throw apiError(error);
      return data.symbols;
    },
    enabled: Boolean(repoId) && Boolean(path),
  });
}

export function useSymbolDetail(repoId: string | undefined, symbolId: string | undefined) {
  return useQuery({
    queryKey: ['symbols', repoId, symbolId],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos/{repo}/symbols/{id}', {
        params: { path: { repo: repoId!, id: symbolId! } },
      });
      if (error) throw apiError(error);
      return data;
    },
    enabled: Boolean(repoId) && Boolean(symbolId),
  });
}
