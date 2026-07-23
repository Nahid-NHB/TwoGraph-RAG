import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundError, parseSymbolId } from '@twograph/core';
import { createLlmProvider } from '@twograph/llm';
import type { RepoContext } from '../context.js';

const SYSTEM_PROMPT =
  "You are a senior code reviewer. Given a function/component's source, suggest concrete, " +
  'minimal improvements (readability, correctness, performance). Be specific and reference ' +
  'line-level detail where useful. Do not rewrite the whole file — a short prioritized list ' +
  'of suggestions is enough.';

export interface OptimizeSuggestions {
  symbol: string;
  suggestions: string;
}

/**
 * Asks the repo's configured LLM for improvement suggestions on a symbol's
 * current source (issue #65). Suggestions-only by design — turning freeform
 * LLM output into a verified edit-operation diff isn't reliable enough to
 * auto-propose, so this never creates a pending edit.
 */
export async function suggestImprovements(
  ctx: RepoContext,
  symbolId: string,
  guidelines: string | undefined,
): Promise<OptimizeSuggestions> {
  const symbol = ctx.store.getSymbol(symbolId);
  if (!symbol) throw new NotFoundError(`symbol not found: ${symbolId}`);
  const { path } = parseSymbolId(symbolId);
  const code = readFileSync(join(ctx.repo.rootPath, path), 'utf8')
    .split('\n')
    .slice(symbol.start_line - 1, symbol.end_line)
    .join('\n');

  const llm = createLlmProvider(ctx.config);
  const guidelineText = guidelines ?? '';
  const result = await llm.complete({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `File: ${path}\nSymbol: ${symbol.name} (${symbol.kind})\n\n` +
          '```\n' +
          `${code}\n` +
          '```\n' +
          (guidelineText ? `\nProject guidelines:\n${guidelineText}` : ''),
      },
    ],
  });

  return { symbol: symbolId, suggestions: result.content };
}
