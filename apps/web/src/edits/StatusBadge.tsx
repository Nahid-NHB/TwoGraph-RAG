export type EditStatus = 'pending' | 'applied' | 'rejected' | 'expired' | 'reverted';

const STATUS_STYLES: Record<EditStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  applied: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  reverted: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

export function StatusBadge({ status }: { status: EditStatus }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
