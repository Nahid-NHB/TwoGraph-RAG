import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, apiError } from '../api/client.js';
import { useRepos } from '../api/hooks.js';

/** Landing route: sends you into the first registered repo, or offers to register one. */
export function RepoGate() {
  const { data: repos, isLoading } = useRepos();
  const queryClient = useQueryClient();
  const [rootPath, setRootPath] = useState('');
  const [name, setName] = useState('');

  const register = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/v1/repos', {
        body: { rootPath, ...(name ? { name } : {}) },
      });
      if (error) throw apiError(error);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });

  if (isLoading) return null;
  if (repos && repos.length > 0) return <Navigate to={`/${repos[0]!.id}`} replace />;

  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        No repositories registered yet
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Register a repository's absolute root path to start browsing it.
      </p>
      <form
        className="flex w-full flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate();
        }}
      >
        <input
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
          placeholder="/absolute/path/to/repo"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          required
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name (optional)"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={register.isPending}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {register.isPending ? 'Registering…' : 'Register'}
        </button>
        {register.isError && (
          <p className="text-sm text-red-600 dark:text-red-400">{register.error.message}</p>
        )}
      </form>
    </div>
  );
}
