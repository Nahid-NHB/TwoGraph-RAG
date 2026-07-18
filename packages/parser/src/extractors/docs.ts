import type { Docstring } from '@twograph/core';
import type { Node } from 'web-tree-sitter';
import type { ExtractionContext, Extractor } from '../registry.js';

/** Parses a raw JSDoc block into a structured Docstring. */
export function parseJsdoc(raw: string): Docstring {
  const cleaned = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*? ?/, ''))
    .join('\n')
    .trim();

  const tagStart = cleaned.search(/^@\w/m);
  const summary = (tagStart === -1 ? cleaned : cleaned.slice(0, tagStart)).trim();
  const tagsText = tagStart === -1 ? '' : cleaned.slice(tagStart);

  const params: { name: string; text: string }[] = [];
  const paramRe = /@param\s+(?:\{[^}]*\}\s+)?(\[?[\w.$]+\]?)\s*-?\s*([^\n]*)/g;
  for (const match of tagsText.matchAll(paramRe)) {
    params.push({ name: (match[1] ?? '').replace(/[[\]]/g, ''), text: (match[2] ?? '').trim() });
  }

  const doc: Docstring = { summary, params, raw };
  const returns = /@returns?\s+([^\n]*)/.exec(tagsText)?.[1]?.trim();
  if (returns) doc.returns = returns;
  const deprecatedMatch = /@deprecated\s*([^\n]*)/.exec(tagsText);
  if (deprecatedMatch) doc.deprecated = deprecatedMatch[1]?.trim() ?? '';
  return doc;
}

/**
 * Attaches JSDoc/TSDoc blocks to the symbol declared immediately after them;
 * a top-of-file block with no adjacent symbol becomes the file doc (issue #16).
 * Must run after the symbol-producing extractors.
 */
export const docsExtractor: Extractor = {
  id: 'docs',
  extract(ctx: ExtractionContext): void {
    const symbolsByLine = new Map<number, typeof ctx.sink.symbols>();
    for (const symbol of ctx.sink.symbols) {
      const list = symbolsByLine.get(symbol.span.startLine) ?? [];
      list.push(symbol);
      symbolsByLine.set(symbol.span.startLine, list);
    }

    const comments: Node[] = [];
    const collect = (node: Node): void => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        if (child.type === 'comment' && child.text.startsWith('/**')) comments.push(child);
        collect(child);
      }
    };
    collect(ctx.tree.rootNode);

    for (const comment of comments) {
      const next = comment.nextNamedSibling;
      const targetLine = next ? next.startPosition.row + 1 : comment.endPosition.row + 2;
      const targets = symbolsByLine.get(targetLine);
      const doc = parseJsdoc(comment.text);

      if (targets && targets.length > 0) {
        for (const symbol of targets) symbol.doc ??= doc;
        continue;
      }

      // Top-of-file block not attached to any symbol → file doc.
      if (comment.startPosition.row === 0 && ctx.sink.fileDoc === undefined) {
        ctx.sink.fileDoc = doc.summary;
      }
    }
  },
};
