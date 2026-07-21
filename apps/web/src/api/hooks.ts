import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export interface SearchFilters {
  kinds?: string[];
  pathPrefix?: string;
  language?: string;
}

export function useSearch(
  repoId: string | undefined,
  query: string,
  mode: 'hybrid' | 'semantic' | 'keyword',
  filters: SearchFilters,
) {
  return useQuery({
    queryKey: ['search', repoId, query, mode, filters],
    queryFn: async () => {
      const { data, error } = await api.POST('/v1/repos/{repo}/search', {
        params: { path: { repo: repoId! } },
        body: { query, mode, k: 20, filters },
      });
      if (error) throw apiError(error);
      return data.hits;
    },
    enabled: Boolean(repoId) && query.trim().length > 0,
  });
}

export function useChatSessions(repoId: string | undefined) {
  return useQuery({
    queryKey: ['chat', 'sessions', repoId],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos/{repo}/chat/sessions', {
        params: { path: { repo: repoId! } },
      });
      if (error) throw apiError(error);
      return [...data].reverse(); // newest first
    },
    enabled: Boolean(repoId),
  });
}

export function useChatSession(repoId: string | undefined, sessionId: string | undefined) {
  return useQuery({
    queryKey: ['chat', 'session', repoId, sessionId],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos/{repo}/chat/sessions/{sid}', {
        params: { path: { repo: repoId!, sid: sessionId! } },
      });
      if (error) throw apiError(error);
      return data;
    },
    enabled: Boolean(repoId) && Boolean(sessionId),
  });
}

export function useCreateChatSession(repoId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (title?: string) => {
      const { data, error } = await api.POST('/v1/repos/{repo}/chat/sessions', {
        params: { path: { repo: repoId! } },
        body: title ? { title } : {},
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['chat', 'sessions', repoId] });
    },
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

export function useSubgraph(
  repoId: string | undefined,
  root: string | undefined,
  depth: number,
  edges: string[],
) {
  return useQuery({
    queryKey: ['graph', 'subgraph', repoId, root, depth, edges],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos/{repo}/graph/subgraph', {
        params: {
          path: { repo: repoId! },
          query: { root: root!, depth, ...(edges.length > 0 ? { edges: edges.join(',') } : {}) },
        },
      });
      if (error) throw apiError(error);
      return data;
    },
    enabled: Boolean(repoId) && Boolean(root),
  });
}
