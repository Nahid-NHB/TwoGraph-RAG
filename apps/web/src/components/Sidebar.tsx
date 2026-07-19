import { FileCode2, GitBranch, MessagesSquare, Network, Search, Workflow } from 'lucide-react';
import { NavLink, useParams } from 'react-router-dom';
import { RepoSwitcher } from './RepoSwitcher.js';
import { ThemeToggle } from './ThemeToggle.js';

const SECTIONS = [
  { to: '', label: 'Explorer', icon: FileCode2, end: true },
  { to: 'search', label: 'Search', icon: Search, end: false },
  { to: 'chat', label: 'Chat', icon: MessagesSquare, end: false },
  { to: 'graph', label: 'Graph', icon: Network, end: false },
  { to: 'edits', label: 'Edits', icon: GitBranch, end: false },
  { to: 'deps', label: 'Dependencies', icon: Workflow, end: false },
] as const;

export function Sidebar() {
  const { repoId } = useParams<{ repoId: string }>();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <RepoSwitcher />
        </div>
        <ThemeToggle />
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {SECTIONS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={repoId ? `/${repoId}/${to}` : '#'}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400 dark:border-slate-800">
        TwoGraph-RAG
      </div>
    </aside>
  );
}
