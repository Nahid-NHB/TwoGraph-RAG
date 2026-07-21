import type { Citation } from '@twograph/core';
import { useNavigate } from 'react-router-dom';

/** A `[S#]` marker turned into a clickable chip that deep-links into the explorer, with a hover preview. */
export function CitationChip({ repoId, citation }: { repoId: string; citation: Citation }) {
  const navigate = useNavigate();

  return (
    <span className="group relative inline-block">
      <button
        type="button"
        onClick={() =>
          void navigate(
            `/${repoId}/blob/${citation.file}${
              citation.symbolId ? `?symbol=${encodeURIComponent(citation.symbolId)}` : ''
            }`,
          )
        }
        className="mx-0.5 rounded bg-sky-100 px-1 text-xs font-medium text-sky-700 hover:bg-sky-200 dark:bg-sky-900/50 dark:text-sky-300 dark:hover:bg-sky-900"
      >
        {citation.file.split('/').pop()}:{citation.startLine}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-slate-700">
        {citation.file}:{citation.startLine}-{citation.endLine}
      </span>
    </span>
  );
}
