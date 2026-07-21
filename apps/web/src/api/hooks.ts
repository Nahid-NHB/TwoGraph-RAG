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

export function useEdits(repoId: string | undefined) {
  return useQuery({
    queryKey: ['edits', repoId],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos/{repo}/edits', {
        params: { path: { repo: repoId! } },
      });
      if (error) throw apiError(error);
      return [...data].reverse(); // newest first
    },
    enabled: Boolean(repoId),
  });
}

export function useEdit(repoId: string | undefined, editId: string | undefined) {
  return useQuery({
    queryKey: ['edits', repoId, editId],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/repos/{repo}/edits/{id}', {
        params: { path: { repo: repoId!, id: editId! } },
      });
      if (error) throw apiError(error);
      return data;
    },
    enabled: Boolean(repoId) && Boolean(editId),
  });
}

export function useProposeEdit(repoId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { operation: string; params: Record<string, unknown> }) => {
      const { data, error } = await api.POST('/v1/repos/{repo}/edits', {
        params: { path: { repo: repoId! } },
        body: input,
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['edits', repoId] });
    },
  });
}

function useEditActionInvalidation(repoId: string | undefined) {
  const queryClient = useQueryClient();
  return async (editId: string) => {
    // Runs on both success and failure — a failed approve still flips the
    // edit's status server-side (e.g. to 'expired' on hash drift), so the
    // detail view must refetch either way.
    await queryClient.invalidateQueries({ queryKey: ['edits', repoId] });
    await queryClient.invalidateQueries({ queryKey: ['edits', repoId, editId] });
  };
}

export function useApproveEdit(repoId: string | undefined) {
  const invalidate = useEditActionInvalidation(repoId);
  return useMutation({
    mutationFn: async (editId: string) => {
      const { data, error } = await api.POST('/v1/repos/{repo}/edits/{id}/approve', {
        params: { path: { repo: repoId!, id: editId } },
      });
      if (error) throw apiError(error);
      return data;
    },
    onSettled: (_data, _error, editId) => invalidate(editId),
  });
}

export function useRejectEdit(repoId: string | undefined) {
  const invalidate = useEditActionInvalidation(repoId);
  return useMutation({
    mutationFn: async (editId: string) => {
      const { data, error } = await api.POST('/v1/repos/{repo}/edits/{id}/reject', {
        params: { path: { repo: repoId!, id: editId } },
      });
      if (error) throw apiError(error);
      return data;
    },
    onSettled: (_data, _error, editId) => invalidate(editId),
  });
}

export function useRevertEdit(repoId: string | undefined) {
  const invalidate = useEditActionInvalidation(repoId);
  return useMutation({
    mutationFn: async (editId: string) => {
      const { data, error } = await api.POST('/v1/repos/{repo}/edits/{id}/revert', {
        params: { path: { repo: repoId!, id: editId } },
      });
      if (error) throw apiError(error);
      return data;
    },
    onSettled: (_data, _error, editId) => invalidate(editId),
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
