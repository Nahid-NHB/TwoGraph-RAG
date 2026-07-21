import { useFileSymbols } from '../api/hooks.js';

const KIND_COLORS: Record<string, string> = {
  Function: 'text-purple-600 dark:text-purple-400',
  Class: 'text-amber-600 dark:text-amber-400',
  Component: 'text-sky-600 dark:text-sky-400',
  Hook: 'text-teal-600 dark:text-teal-400',
  Interface: 'text-emerald-600 dark:text-emerald-400',
  TypeAlias: 'text-emerald-600 dark:text-emerald-400',
  Variable: 'text-slate-500 dark:text-slate-400',
};

export function SymbolOutline({
  repoId,
  path,
  selectedSymbolId,
  onSelectSymbol,
}: {
  repoId: string;
  path: string;
  selectedSymbolId: string | undefined;
  onSelectSymbol: (symbolId: string) => void;
}) {
  const { data: symbols, isLoading } = useFileSymbols(repoId, path);

  if (isLoading) return <p className="p-3 text-sm text-slate-400">Loading outline…</p>;
  if (!symbols || symbols.length === 0) {
    return <p className="p-3 text-sm text-slate-400">No symbols found in this file.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {symbols.map((symbol) => (
        <li key={symbol.id}>
          <button
            type="button"
            onClick={() => onSelectSymbol(symbol.id)}
            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
              symbol.id === selectedSymbolId
                ? 'bg-slate-100 dark:bg-slate-800'
                : 'hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`text-xs font-medium ${KIND_COLORS[symbol.kind] ?? 'text-slate-500'}`}
              >
                {symbol.kind}
              </span>
              <span className="truncate font-mono text-slate-800 dark:text-slate-200">
                {symbol.name}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {symbol.exported && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  export
                </span>
              )}
              <span className="text-[11px] text-slate-400">L{symbol.startLine}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
