import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSymbolDetail } from '../api/hooks.js';
import { HierarchyTree, type HierarchyDirection } from '../hierarchy/HierarchyTree.js';

const DIRECTIONS: { value: HierarchyDirection; label: string }[] = [
  { value: 'callers', label: 'Callers (up)' },
  { value: 'callees', label: 'Callees (down)' },
];

/**
 * Call-hierarchy / component-usage tree page (issue #62): `?root=<symbolId>`
 * seeds the tree; `?dir=callers|callees` toggles direction for a regular
 * symbol, or is fixed to `component` (no toggle) when linked from a
 * Component's "Usage tree" button.
 */
export function TreePage() {
  const { repoId } = useParams<{ repoId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const root = searchParams.get('root') ?? undefined;
  const dir = (searchParams.get('dir') ?? 'callers') as HierarchyDirection;
  const [rootInput, setRootInput] = useState('');

  const { data: symbol, isLoading } = useSymbolDetail(repoId, root);

  if (!repoId) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (rootInput.trim()) setSearchParams({ root: rootInput.trim(), dir });
          }}
          className="flex items-center gap-1"
        >
          <input
            value={rootInput}
            onChange={(e) => setRootInput(e.target.value)}
            placeholder="root symbol id"
            className="w-64 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Go
          </button>
        </form>

        {dir !== 'component' && (
          <div className="flex gap-1">
            {DIRECTIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => root && setSearchParams({ root, dir: d.value })}
                className={`rounded px-2 py-1 text-xs font-medium ${
                  dir === d.value
                    ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
        {dir === 'component' && (
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Component usage tree
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {!root && (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Enter a root symbol id to explore its hierarchy.
          </div>
        )}
        {root && isLoading && (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Loading…
          </div>
        )}
        {root && symbol && (
          <HierarchyTree
            key={`${root}:${dir}`}
            repoId={repoId}
            root={{ id: symbol.id, name: symbol.name, kind: symbol.kind, path: symbol.path }}
            direction={dir}
            onNavigate={(id) => setSearchParams({ root: id, dir })}
          />
        )}
      </div>
    </div>
  );
}
