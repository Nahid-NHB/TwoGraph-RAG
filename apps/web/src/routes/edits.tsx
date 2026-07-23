import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { EditDetail } from '../edits/EditDetail.js';
import { EditList } from '../edits/EditList.js';
import { ProposeEditForm } from '../edits/ProposeEditForm.js';

/**
 * Pending-edits page (issue #61): multi-file diff viewer, approve/reject/
 * revert with confirmation, status timeline, and a propose-edit form
 * reachable both here and (pre-filled) from symbol pages via `?operation=`
 * and `?symbolId=`.
 */
export function EditsPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('edit') ?? undefined;
  const initialOperation = searchParams.get('operation') ?? undefined;
  const initialSymbolId = searchParams.get('symbolId') ?? undefined;
  const [showPropose, setShowPropose] = useState(Boolean(initialOperation));

  function select(id: string): void {
    setSearchParams({ edit: id });
    setShowPropose(false);
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 p-2 dark:border-slate-800">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Edits
          </h2>
          <button
            type="button"
            onClick={() => setShowPropose((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Plus size={12} /> Propose
          </button>
        </div>
        {showPropose && (
          <div className="border-b border-slate-200 dark:border-slate-800">
            <ProposeEditForm
              repoId={repoId}
              initialOperation={initialOperation}
              initialParams={initialSymbolId ? { symbolId: initialSymbolId } : undefined}
              onProposed={select}
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <EditList repoId={repoId} selectedId={selectedId} onSelect={select} />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {selectedId ? (
          <EditDetail repoId={repoId} editId={selectedId} onReproposed={select} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Select an edit to review its diff.
          </div>
        )}
      </div>
    </div>
  );
}
