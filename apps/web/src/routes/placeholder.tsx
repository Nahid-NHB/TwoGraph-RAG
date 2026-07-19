/** Temporary stand-in for a section built out in a later issue. */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Coming soon.</p>
    </div>
  );
}
