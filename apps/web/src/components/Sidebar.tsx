import {
  FileCode2,
  GitBranch,
  ListTree,
  MessagesSquare,
  Network,
  Search,
  Workflow,
} from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { RepoSwitcher } from './RepoSwitcher.js';
import { ThemeToggle } from './ThemeToggle.js';

const SECTIONS = [
  // `activePrefixes` lists every sub-route (beyond the exact `to`) that
  // should still highlight this entry — Explorer also owns `blob/*`.
  { to: '', label: 'Explorer', icon: FileCode2, activePrefixes: ['blob'] },
  { to: 'search', label: 'Search', icon: Search, activePrefixes: [] },
  { to: 'chat', label: 'Chat', icon: MessagesSquare, activePrefixes: [] },
  { to: 'graph', label: 'Graph', icon: Network, activePrefixes: [] },
  { to: 'tree', label: 'Call Tree', icon: ListTree, activePrefixes: [] },
  { to: 'edits', label: 'Edits', icon: GitBranch, activePrefixes: [] },
  { to: 'deps', label: 'Dependencies', icon: Workflow, activePrefixes: [] },
] as const;

export function Sidebar() {
  const { repoId } = useParams<{ repoId: string }>();
  const location = useLocation();

  function isActive(to: string, activePrefixes: readonly string[]): boolean {
    if (!repoId) return false;
    const base = `/${repoId}`;
    const section = `${base}/${to}`.replace(/\/$/, '');
    if (location.pathname === (section || base)) return true;
    return activePrefixes.some((prefix) => location.pathname.startsWith(`${base}/${prefix}/`));
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <RepoSwitcher />
        </div>
        <ThemeToggle />
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {SECTIONS.map(({ to, label, icon: Icon, activePrefixes }) => (
          <Link
            key={to}
            to={repoId ? `/${repoId}/${to}` : '#'}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
              isActive(to, activePrefixes)
                ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400 dark:border-slate-800">
        TwoGraph-RAG
      </div>
    </aside>
  );
}
