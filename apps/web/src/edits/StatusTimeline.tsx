import type { EditStatus } from './StatusBadge.js';

const RESOLUTION_LABEL: Record<Exclude<EditStatus, 'pending'>, string> = {
  applied: 'Approved & applied',
  rejected: 'Rejected',
  expired: 'Expired (stale)',
  reverted: 'Reverted',
};

/** Created → resolved timeline for a single edit (issue #61 acceptance criteria). */
export function StatusTimeline({
  status,
  createdAt,
  resolvedAt,
}: {
  status: EditStatus;
  createdAt: string;
  resolvedAt: string | null;
}) {
  const steps = [{ label: 'Proposed', at: createdAt }];
  if (status !== 'pending' && resolvedAt) {
    steps.push({ label: RESOLUTION_LABEL[status], at: resolvedAt });
  }

  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex items-center gap-2 text-xs">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400 dark:bg-slate-600" />
          <span className="font-medium text-slate-700 dark:text-slate-300">{step.label}</span>
          <span className="text-slate-400">{new Date(step.at).toLocaleString()}</span>
        </li>
      ))}
      {status === 'pending' && (
        <li className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-dashed border-slate-400" />
          Awaiting approval
        </li>
      )}
    </ol>
  );
}
