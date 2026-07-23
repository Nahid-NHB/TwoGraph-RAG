import { useEdits } from '../api/hooks.js';
import { StatusBadge } from './StatusBadge.js';

export function EditList({
  repoId,
  selectedId,
  onSelect,
}: {
  repoId: string | undefined;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const { data: edits, isLoading } = useEdits(repoId);

  if (isLoading) return <p className="p-3 text-sm text-slate-400">Loading…</p>;
  if (!edits || edits.length === 0) {
    return <p className="p-3 text-sm text-slate-400">No edits proposed yet.</p>;
  }

  return (
    <ul className="divide-y divide-slate-200 dark:divide-slate-800">
      {edits.map((edit) => (
        <li key={edit.id}>
          <button
            type="button"
            onClick={() => onSelect(edit.id)}
            className={`block w-full px-3 py-2.5 text-left ${
              edit.id === selectedId
                ? 'bg-slate-100 dark:bg-slate-800'
                : 'hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-xs font-medium text-slate-900 dark:text-slate-100">
                {edit.operation}
              </span>
              <StatusBadge status={edit.status} />
            </div>
            <div className="mt-1 truncate text-xs text-slate-400">
              {edit.affectedFiles.join(', ') || '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {new Date(edit.createdAt).toLocaleString()}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
