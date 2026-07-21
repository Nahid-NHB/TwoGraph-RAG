import { useState } from 'react';
import { parseUnifiedDiff, type DiffLine } from './diff.js';

const LINE_STYLES: Record<DiffLine['type'], string> = {
  add: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
  del: 'bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-200',
  context: 'text-slate-600 dark:text-slate-400',
};

const LINE_MARKER: Record<DiffLine['type'], string> = { add: '+', del: '-', context: ' ' };

/** Multi-file unified-diff renderer with per-file navigation (issue #61). */
export function DiffView({ diff }: { diff: string }) {
  const files = parseUnifiedDiff(diff);
  const [selected, setSelected] = useState(0);
  const file = files[selected];

  if (files.length === 0) {
    return <p className="p-4 text-sm text-slate-400">No changes.</p>;
  }

  return (
    <div className="flex h-full min-h-0">
      {files.length > 1 && (
        <nav className="w-56 shrink-0 overflow-auto border-r border-slate-200 dark:border-slate-800">
          {files.map((f, i) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setSelected(i)}
              className={`block w-full truncate px-3 py-2 text-left font-mono text-xs ${
                i === selected
                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                  : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900'
              }`}
            >
              {f.path}
            </button>
          ))}
        </nav>
      )}
      <div className="min-w-0 flex-1 overflow-auto">
        {file && (
          <div>
            <div className="sticky top-0 border-b border-slate-200 bg-white px-3 py-1.5 font-mono text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              {file.path}
            </div>
            {file.hunks.map((hunk, hi) => (
              <div key={hi}>
                <div className="bg-sky-50 px-3 py-1 font-mono text-xs text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
                  {hunk.header}
                </div>
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className={`flex whitespace-pre-wrap px-3 font-mono text-xs ${LINE_STYLES[line.type]}`}
                  >
                    <span className="w-4 shrink-0 select-none opacity-60">
                      {LINE_MARKER[line.type]}
                    </span>
                    <span className="min-w-0 flex-1">{line.content}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
