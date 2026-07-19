import { ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useRepos } from '../api/hooks.js';

/** Everything in the current path after the leading `/:repoId` segment, e.g. `/search`. */
function sectionPath(pathname: string, repoId: string | undefined): string {
  if (!repoId) return '';
  const rest = pathname.slice(pathname.indexOf(repoId) + repoId.length);
  return rest || '';
}

export function RepoSwitcher() {
  const { repoId } = useParams<{ repoId: string }>();
  const { data: repos } = useRepos();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const current = repos?.find((r) => r.id === repoId);

  if (!repos || repos.length === 0) {
    return <span className="truncate text-sm text-slate-400">No repos registered</span>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-slate-900 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
      >
        <span className="truncate">{current?.name ?? 'Select a repo'}</span>
        <ChevronsUpDown size={14} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close repo switcher"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul className="absolute z-20 mt-1 w-full min-w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {repos.map((repo) => (
              <li key={repo.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void navigate(`/${repo.id}${sectionPath(location.pathname, repoId)}`);
                  }}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {repo.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
