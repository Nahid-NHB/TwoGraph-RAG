import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSearch, type SearchFilters } from '../api/hooks.js';

type Mode = 'hybrid' | 'semantic' | 'keyword';

const MODES: Mode[] = ['hybrid', 'semantic', 'keyword'];

const SOURCE_STYLES: Record<string, string> = {
  bm25: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  vector: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  graph: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
};

/** Bolds every case-insensitive occurrence of any query word — a lightweight stand-in for server-side highlight ranges. */
function highlight(text: string, query: string): ReactNode[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [text];
  const pattern = new RegExp(
    `(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'ig',
  );
  return text.split(pattern).map((part, i) =>
    pattern.test(part) ? (
      <mark key={i} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-700/60">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/** Hybrid search over `/search` (issue #58): mode toggle, filters round-tripped via URL, provenance badges. */
export function SearchPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQuery = searchParams.get('q') ?? '';
  const mode = (searchParams.get('mode') as Mode | null) ?? 'hybrid';
  const kind = searchParams.get('kind') ?? '';
  const path = searchParams.get('path') ?? '';
  const language = searchParams.get('lang') ?? '';

  const [inputValue, setInputValue] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-focuses the input if cmd-k is pressed while already on this page —
  // the cross-app "open search from anywhere" listener lives in RootLayout.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Debounce URL updates so every keystroke doesn't fire a request + history entry.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (inputValue) next.set('q', inputValue);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => clearTimeout(handle);
  }, [inputValue, setSearchParams]);

  function updateParam(key: string, value: string): void {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  const filters: SearchFilters = {
    ...(kind ? { kinds: [kind] } : {}),
    ...(path ? { pathPrefix: path } : {}),
    ...(language ? { language } : {}),
  };
  const { data: hits, isFetching } = useSearch(repoId, urlQuery, mode, filters);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <input
        ref={inputRef}
        autoFocus
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Search code… (⌘K)"
        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-base text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-slate-300 dark:border-slate-700">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => updateParam('mode', m)}
              className={`px-3 py-1 text-xs font-medium capitalize first:rounded-l-md last:rounded-r-md ${
                mode === m
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <input
          value={kind}
          onChange={(e) => updateParam('kind', e.target.value)}
          placeholder="kind (e.g. Function)"
          className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <input
          value={path}
          onChange={(e) => updateParam('path', e.target.value)}
          placeholder="path prefix"
          className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        <input
          value={language}
          onChange={(e) => updateParam('lang', e.target.value)}
          placeholder="language"
          className="w-32 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      <div className="mt-4 space-y-1">
        {isFetching && <p className="text-sm text-slate-400">Searching…</p>}
        {!isFetching && urlQuery && hits && hits.length === 0 && (
          <p className="text-sm text-slate-400">No results.</p>
        )}
        {hits?.map((hit) => (
          <button
            key={hit.symbolId}
            type="button"
            onClick={() =>
              hit.path &&
              void navigate(
                `/${repoId}/blob/${hit.path}?symbol=${encodeURIComponent(hit.symbolId)}`,
              )
            }
            className="block w-full rounded-lg border border-transparent p-3 text-left hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-800 dark:hover:bg-slate-900"
          >
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                {hit.name ?? hit.symbolId}
              </span>
              {hit.kind && <span className="text-xs text-slate-400">{hit.kind}</span>}
              <span
                className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  SOURCE_STYLES[hit.source] ?? 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                }`}
              >
                {hit.source}
              </span>
            </div>
            {hit.path && <div className="mt-0.5 text-xs text-slate-400">{hit.path}</div>}
            {hit.snippet && (
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-400">
                {highlight(hit.snippet, urlQuery)}
              </pre>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
