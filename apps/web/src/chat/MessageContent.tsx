import type { Citation } from '@twograph/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CitationChip } from './CitationChip.js';

const CITE_PREFIX = '#cite-';

/**
 * Maps each unique `[S#]` tag to its citation, in the same first-appearance
 * order the server's own citation extraction uses — the citations array
 * itself carries no tag, only positional order (issue #59).
 */
function buildCitationMap(text: string, citations: Citation[]): Map<string, Citation> {
  const map = new Map<string, Citation>();
  let next = 0;
  for (const match of text.matchAll(/\[S\d+\]/g)) {
    const tag = match[0].slice(1, -1);
    if (!map.has(tag) && next < citations.length) {
      map.set(tag, citations[next]!);
      next++;
    }
  }
  return map;
}

/** Rewrites `[S3]` into a markdown link so react-markdown gives us a hook to render a chip instead. */
function linkifyCitations(text: string, citationMap: Map<string, Citation>): string {
  return text.replace(/\[S\d+\]/g, (raw) => {
    const tag = raw.slice(1, -1);
    return citationMap.has(tag) ? `[${raw}](${CITE_PREFIX}${tag})` : raw;
  });
}

/** Renders grounded chat markdown, turning `[S#]` citation markers into deep-linking chips with hover previews. */
export function MessageContent({
  repoId,
  content,
  citations,
}: {
  repoId: string;
  content: string;
  citations: Citation[];
}) {
  const citationMap = buildCitationMap(content, citations);
  const withLinks = linkifyCitations(content, citationMap);

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-slate-100 dark:prose-pre:bg-slate-900">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith(CITE_PREFIX)) {
              const tag = href.slice(CITE_PREFIX.length);
              const citation = citationMap.get(tag);
              if (citation) return <CitationChip repoId={repoId} citation={citation} />;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {withLinks}
      </ReactMarkdown>
    </div>
  );
}
