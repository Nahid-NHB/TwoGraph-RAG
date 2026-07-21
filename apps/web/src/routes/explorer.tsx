import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFileTree } from '../api/hooks.js';
import { FileTree } from '../explorer/FileTree.js';
import { SymbolDetail } from '../explorer/SymbolDetail.js';
import { SymbolOutline } from '../explorer/SymbolOutline.js';

/**
 * Repository explorer (issue #57): virtualized file tree, per-file symbol
 * outline, and a symbol detail pane with highlighted source. Both the file
 * and the symbol are deep-linkable — `/:repoId/blob/:path?symbol=:id`.
 */
export function Explorer() {
  const { repoId, '*': path } = useParams<{ repoId: string; '*': string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const symbolId = searchParams.get('symbol') ?? undefined;

  const { data: tree, isLoading, isError } = useFileTree(repoId);

  if (!repoId) return null;

  function selectFile(nextPath: string): void {
    void navigate(`/${repoId}/blob/${nextPath}`);
  }

  function selectSymbol(nextSymbolId: string): void {
    if (!path) return;
    void navigate(`/${repoId}/blob/${path}?symbol=${encodeURIComponent(nextSymbolId)}`);
  }

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 overflow-hidden border-r border-slate-200 dark:border-slate-800">
        {isLoading && <p className="p-3 text-sm text-slate-400">Loading files…</p>}
        {isError && <p className="p-3 text-sm text-red-500">Failed to load the file tree.</p>}
        {tree && <FileTree tree={tree} selectedPath={path} onSelectFile={selectFile} />}
      </div>

      {path && (
        <div className="w-80 shrink-0 overflow-auto border-r border-slate-200 dark:border-slate-800">
          <div className="border-b border-slate-200 px-3 py-2 font-mono text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {path}
          </div>
          <SymbolOutline
            repoId={repoId}
            path={path}
            selectedSymbolId={symbolId}
            onSelectSymbol={selectSymbol}
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {symbolId ? (
          <SymbolDetail repoId={repoId} symbolId={symbolId} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            {path ? 'Select a symbol to view its source.' : 'Select a file to browse its symbols.'}
          </div>
        )}
      </div>
    </div>
  );
}
