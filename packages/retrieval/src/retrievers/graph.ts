import type { RankedHit } from '@twograph/core';
import type { GraphNodeSummary, GraphQueries, HierarchyEntry } from '@twograph/graph';
import type { Retriever, RetrieveOptions } from '../retriever.js';

export type GraphIntentKind = 'callers' | 'callees' | 'usage';

export interface GraphIntent {
  kind: GraphIntentKind;
  /** Identifier-like tokens from the query, most-likely-target last. */
  candidates: string[];
}

const STOPWORDS = new Set([
  'who',
  'what',
  'calls',
  'call',
  'invokes',
  'callers',
  'callees',
  'callee',
  'of',
  'does',
  'made',
  'by',
  'uses',
  'usage',
  'used',
  'renders',
  'the',
  'a',
  'an',
  'is',
  'in',
  'on',
  'it',
  'this',
  'that',
  'them',
  'something',
  'anything',
]);

const INTENT_PATTERNS: { re: RegExp; kind: GraphIntentKind }[] = [
  { re: /\bwho (?:calls|invokes)\b/i, kind: 'callers' },
  { re: /\bcallers? of\b/i, kind: 'callers' },
  { re: /\bcallees? of\b/i, kind: 'callees' },
  { re: /\bwhat does .* call\b/i, kind: 'callees' },
  { re: /\bcalls made by\b/i, kind: 'callees' },
  { re: /\bwho uses\b/i, kind: 'usage' },
  { re: /\busage of\b/i, kind: 'usage' },
  { re: /\bused by\b/i, kind: 'usage' },
];

/** Detects name-anchored graph intents ("who calls X") — no LLM required. */
export function detectGraphIntent(query: string): GraphIntent | null {
  const matched = INTENT_PATTERNS.find((p) => p.re.test(query));
  if (!matched) return null;

  const tokens = query.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  const candidates = tokens.filter((t) => !STOPWORDS.has(t.toLowerCase()));
  return candidates.length > 0 ? { kind: matched.kind, candidates } : null;
}

/**
 * Answers name-anchored graph intents standalone (issue #36): resolves a
 * candidate identifier to a graph node, then runs the matching hierarchy query.
 */
export class GraphRetriever implements Retriever {
  readonly id = 'graph' as const;

  constructor(
    private readonly queries: GraphQueries,
    private readonly repo: string,
  ) {}

  async retrieve(query: string, options: RetrieveOptions = {}): Promise<RankedHit[]> {
    const intent = detectGraphIntent(query);
    if (!intent) return [];

    const seed = await this.resolveSeed(intent.candidates);
    if (!seed) return [];

    const k = options.k ?? 20;
    if (intent.kind === 'callers') {
      return this.toHits(await this.queries.callers(this.repo, seed.id, 2), seed, 'callers', k);
    }
    if (intent.kind === 'callees') {
      return this.toHits(await this.queries.callees(this.repo, seed.id, 2), seed, 'callees', k);
    }
    return this.toHits(await this.queries.componentUsage(this.repo, seed.id, 3), seed, 'usage', k);
  }

  /** Tries candidates last-first — questions tend to name the target last. */
  private async resolveSeed(candidates: string[]): Promise<GraphNodeSummary | undefined> {
    for (const name of [...candidates].reverse()) {
      const [match] = await this.queries.findByName(this.repo, name);
      if (match) return match;
    }
    return undefined;
  }

  private toHits(
    entries: HierarchyEntry[],
    seed: GraphNodeSummary,
    kind: GraphIntentKind,
    k: number,
  ): RankedHit[] {
    return entries.slice(0, k).map((e) => ({
      symbolId: e.id,
      score: 1 / (1 + e.depth),
      source: this.id,
      graphPath: graphPathFor(kind, seed, e),
      provenance: {},
    }));
  }
}

function graphPathFor(
  kind: GraphIntentKind,
  seed: GraphNodeSummary,
  entry: HierarchyEntry,
): string {
  const depthSuffix = entry.depth > 1 ? ` (depth ${String(entry.depth)})` : '';
  if (kind === 'callers') return `${entry.name} → ${seed.name}${depthSuffix}`;
  if (kind === 'callees') return `${seed.name} → ${entry.name}${depthSuffix}`;
  return `${entry.name} renders ${seed.name}${depthSuffix}`;
}
