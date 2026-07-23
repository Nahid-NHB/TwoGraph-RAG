import { z } from 'zod';
import type { LruCache } from '@twograph/core';
import type { QUERY_TEMPLATES } from '@twograph/graph';
import type { LlmProvider } from '@twograph/llm';

export const multiQueryResultSchema = z.object({
  queries: z.array(z.string().min(1)).min(2).max(4),
});
export type MultiQueryOutput = z.infer<typeof multiQueryResultSchema>;

export interface GraphIntent {
  /** Name of a registered template in @twograph/graph's QUERY_TEMPLATES. */
  template: keyof typeof QUERY_TEMPLATES;
  params: Record<string, string>;
}

export interface MultiQueryResult {
  /** 2-4 diverse rewrites (keyword / paraphrase / symbol-guess), or just the
   * original question if the LLM call or its output failed validation. */
  queries: string[];
  /** Set when the question matches a graph-intent pattern — route straight
   * to this template (docs/07 §1) instead of, or alongside, hybrid search. */
  graphIntent?: GraphIntent;
  /** False if the LLM output had to be discarded (parse/validation/call failure). */
  usedLlm: boolean;
}

const INTENT_PATTERNS: {
  re: RegExp;
  build: (match: RegExpMatchArray) => GraphIntent;
}[] = [
  {
    re: /\bwho (?:calls|invokes)\s+(\S+)/i,
    build: (m) => ({ template: 'who_calls', params: { name: m[1]! } }),
  },
  {
    re: /\bcallers? of\s+(\S+)/i,
    build: (m) => ({ template: 'who_calls', params: { name: m[1]! } }),
  },
  {
    re: /\b(?:files? )?depend(?:s|ing)? on\s+(\S+)/i,
    build: (m) => ({ template: 'files_depending_on', params: { dependency: m[1]! } }),
  },
  {
    re: /\bwho (?:imports|uses the)\s+(\S+)\s+(?:package|dependency)\b/i,
    build: (m) => ({ template: 'files_depending_on', params: { dependency: m[1]! } }),
  },
  {
    re: /\bunused\b.*\bcomponents?\b|\bcomponents?\b.*\bunused\b|\bunused (?:code|exports?)\b|\bnever (?:rendered|used)\b|\bdead components?\b/i,
    build: () => ({ template: 'unused_components', params: {} }),
  },
  {
    re: /\bcontext (?:flow|providers?)\b|\bproviders? and consumers\b/i,
    build: () => ({ template: 'context_flow', params: {} }),
  },
  {
    re: /\ball routes\b|\broute (?:table|list)\b|\blist (?:the )?routes\b/i,
    build: () => ({ template: 'routes', params: {} }),
  },
];

/** Detects name-anchored and repo-wide graph intents that route straight to a QUERY_TEMPLATE. */
export function detectGraphIntent(question: string): GraphIntent | undefined {
  for (const pattern of INTENT_PATTERNS) {
    const match = question.match(pattern.re);
    if (match) return pattern.build(match);
  }
  return undefined;
}

const SYSTEM_PROMPT = `You rewrite a code-search question into 2-4 diverse search queries for a hybrid
(keyword + semantic) code retrieval system. Include, when applicable:
- a literal keyword form (exact identifiers/terms likely to appear in code)
- a semantic paraphrase (how a developer would describe the intent)
- a symbol-guess form (plausible function/component/hook names)

Respond with ONLY a JSON object of the form {"queries": ["...", "...", ...]} — 2 to 4 items, no prose.`;

function parseQueries(content: string): MultiQueryOutput | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  const result = multiQueryResultSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

export interface MultiQueryCache {
  store: LruCache<string, MultiQueryResult>;
  /** Typically `${repo}:${indexVersion}:${question}` (issue #71) — the LLM
   * rewrite of a question only depends on the question text and what's in
   * the index, so it's safe to reuse across requests as long as neither
   * changed. */
  key: string;
}

/**
 * Rewrites a question into diverse queries and detects graph intents (issue
 * #43, docs/07 §1). Failure-safe: any LLM error or malformed/invalid output
 * falls back to the original question alone — the graph intent (if any) is
 * always detected regardless, since it's a pure pattern match.
 *
 * `cache` is opt-in (issue #71): when given, a hit skips the LLM call
 * entirely. Callers key it by index version so a reindex naturally stops
 * serving a stale rewrite.
 */
export async function generateMultiQuery(
  llm: LlmProvider,
  question: string,
  signal?: AbortSignal,
  cache?: MultiQueryCache,
): Promise<MultiQueryResult> {
  const cached = cache?.store.get(cache.key);
  if (cached) return cached;

  const graphIntent = detectGraphIntent(question);
  let result: MultiQueryResult;

  try {
    const completion = await llm.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question },
      ],
      temperature: 0.3,
      maxTokens: 300,
      ...(signal ? { signal } : {}),
    });
    const parsed = parseQueries(completion.content);
    result = parsed
      ? { queries: parsed.queries, ...(graphIntent ? { graphIntent } : {}), usedLlm: true }
      : { queries: [question], ...(graphIntent ? { graphIntent } : {}), usedLlm: false };
  } catch (err) {
    // A caller-initiated abort should halt the whole pipeline, not be
    // absorbed as an ordinary LLM failure (issue #47).
    if (signal?.aborted) throw err;
    // Fall through to the failure-safe fallback below.
    result = { queries: [question], ...(graphIntent ? { graphIntent } : {}), usedLlm: false };
  }

  cache?.store.set(cache.key, result);
  return result;
}
