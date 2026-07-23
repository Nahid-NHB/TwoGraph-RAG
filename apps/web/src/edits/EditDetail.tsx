import { useState } from 'react';
import { useApproveEdit, useEdit, useRejectEdit, useRevertEdit } from '../api/hooks.js';
import { DiffView } from './DiffView.js';
import { ProposeEditForm } from './ProposeEditForm.js';
import { StatusBadge } from './StatusBadge.js';
import { StatusTimeline } from './StatusTimeline.js';

export function EditDetail({
  repoId,
  editId,
  onReproposed,
}: {
  repoId: string | undefined;
  editId: string;
  onReproposed: (id: string) => void;
}) {
  const { data: edit, isLoading } = useEdit(repoId, editId);
  const approve = useApproveEdit(repoId);
  const reject = useRejectEdit(repoId);
  const revert = useRevertEdit(repoId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRepropose, setShowRepropose] = useState(false);

  if (isLoading) return <p className="p-4 text-sm text-slate-400">Loading…</p>;
  if (!edit) return null;

  const status = edit.status;

  async function run(action: 'approve' | 'reject' | 'revert', confirmMsg: string): Promise<void> {
    if (!window.confirm(confirmMsg)) return;
    setActionError(null);
    try {
      if (action === 'approve') await approve.mutateAsync(editId);
      else if (action === 'reject') await reject.mutateAsync(editId);
      else await revert.mutateAsync(editId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  const busy = approve.isPending || reject.isPending || revert.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">
            {edit.operation}
          </span>
          <StatusBadge status={status} />
          <div className="ml-auto flex gap-2">
            {status === 'pending' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run('approve', 'Approve and apply this edit?')}
                  className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run('reject', 'Reject this edit?')}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  Reject
                </button>
              </>
            )}
            {status === 'applied' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('revert', 'Revert this applied edit?')}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Revert
              </button>
            )}
            {status === 'expired' && (
              <button
                type="button"
                onClick={() => setShowRepropose((v) => !v)}
                className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              >
                Re-propose
              </button>
            )}
          </div>
        </div>
        <div className="mt-2">
          <StatusTimeline status={status} createdAt={edit.createdAt} resolvedAt={edit.resolvedAt} />
        </div>
        {status === 'expired' && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            This edit&apos;s target files changed since it was proposed and can no longer be applied
            — re-propose it against the current file state.
          </p>
        )}
        {actionError && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{actionError}</p>
        )}
      </div>

      {showRepropose && (
        <div className="border-b border-slate-200 dark:border-slate-800">
          <ProposeEditForm
            repoId={repoId}
            initialOperation={edit.operation}
            initialParams={edit.params}
            onProposed={(id) => {
              setShowRepropose(false);
              onReproposed(id);
            }}
          />
        </div>
      )}

      <div className="min-h-0 flex-1">
        <DiffView diff={edit.diff} />
      </div>
    </div>
  );
}
