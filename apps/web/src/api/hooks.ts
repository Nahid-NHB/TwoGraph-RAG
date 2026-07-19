import { useQuery } from '@tanstack/react-query';
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
