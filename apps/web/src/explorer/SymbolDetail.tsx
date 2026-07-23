import Editor from '@monaco-editor/react';
import { GitBranch, ListTree, Network } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSymbolDetail } from '../api/hooks.js';
import { useTheme } from '../theme/theme-context.js';

const QUICK_EDIT_OPERATIONS = [
  { id: 'rename_symbol', label: 'Rename' },
  { id: 'add_parameter', label: 'Add param' },
  { id: 'remove_parameter', label: 'Remove param' },
  { id: 'move_function', label: 'Move' },
] as const;

function languageFor(path: string): string {
  if (path.endsWith('.tsx') || path.endsWith('.jsx')) return 'typescript';
  if (path.endsWith('.ts')) return 'typescript';
  return 'plaintext';
}

export function SymbolDetail({ repoId, symbolId }: { repoId: string; symbolId: string }) {
  const { data: symbol, isLoading } = useSymbolDetail(repoId, symbolId);
  const { theme } = useTheme();
  const navigate = useNavigate();

  if (isLoading) return <p className="p-4 text-sm text-slate-400">Loading…</p>;
  if (!symbol) return null;

  function goTo(neighbor: { path: string | null; id: string }): void {
    if (!neighbor.path) return;
    void navigate(`/${repoId}/blob/${neighbor.path}?symbol=${encodeURIComponent(neighbor.id)}`);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {symbol.kind}
          </span>
          <h2 className="truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">
            {symbol.name}
          </h2>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {QUICK_EDIT_OPERATIONS.map((op) => (
              <button
                key={op.id}
                type="button"
                onClick={() =>
                  void navigate(
                    `/${repoId}/edits?operation=${op.id}&symbolId=${encodeURIComponent(symbolId)}`,
                  )
                }
                className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <GitBranch size={12} /> {op.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void navigate(`/${repoId}/graph?root=${encodeURIComponent(symbolId)}`)}
              className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <Network size={12} /> View in graph
            </button>
            <button
              type="button"
              onClick={() =>
                void navigate(
                  `/${repoId}/tree?root=${encodeURIComponent(symbolId)}&dir=${symbol.kind === 'Component' ? 'component' : 'callers'}`,
                )
              }
              className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <ListTree size={12} /> {symbol.kind === 'Component' ? 'Usage tree' : 'Call tree'}
            </button>
          </div>
        </div>
        {symbol.signature && (
          <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {symbol.signature}
          </pre>
        )}
        {symbol.doc && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{symbol.doc}</p>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language={languageFor(symbol.path)}
          value={symbol.code}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            lineNumbers: (n: number) => String(n + symbol.startLine - 1),
          }}
        />
      </div>

      {(symbol.neighbors.incoming.length > 0 || symbol.neighbors.outgoing.length > 0) && (
        <div className="max-h-48 overflow-auto border-t border-slate-200 p-3 text-sm dark:border-slate-800">
          {symbol.neighbors.incoming.length > 0 && (
            <div className="mb-2">
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Callers / usages
              </h3>
              <ul className="space-y-0.5">
                {symbol.neighbors.incoming.map((n) => (
                  <li key={`${n.edge}-${n.id}`}>
                    <button
                      type="button"
                      onClick={() => goTo(n)}
                      className="font-mono text-sky-700 hover:underline dark:text-sky-400"
                    >
                      {n.name}
                    </button>
                    <span className="ml-1 text-xs text-slate-400">{n.edge}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {symbol.neighbors.outgoing.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Calls / uses
              </h3>
              <ul className="space-y-0.5">
                {symbol.neighbors.outgoing.map((n) => (
                  <li key={`${n.edge}-${n.id}`}>
                    <button
                      type="button"
                      onClick={() => goTo(n)}
                      className="font-mono text-sky-700 hover:underline dark:text-sky-400"
                    >
                      {n.name}
                    </button>
                    <span className="ml-1 text-xs text-slate-400">{n.edge}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
