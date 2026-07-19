import { dirname } from 'node:path';
import { parseSymbolId } from '@twograph/core';
import type { HierarchyEntry } from '@twograph/graph';
import type { MetadataStore, SymbolRow } from '@twograph/store';

/** The subset of GraphQueries the assembler needs — a real GraphQueries satisfies this. */
export interface ContextGraphSource {
  callers(repo: string, symbolId: string, depth?: number): Promise<HierarchyEntry[]>;
  callees(repo: string, symbolId: string, depth?: number): Promise<HierarchyEntry[]>;
  filePaths(repo: string): Promise<string[]>;
  neighbors(
    repo: string,
    symbolId: string,
  ): Promise<{
    outgoing: { id: string; name: string; kind: string; path: string | null; edge: string }[];
    incoming: { id: string; name: string; kind: string; path: string | null; edge: string }[];
  }>;
}

export interface ContextAssemblerDeps {
  store: MetadataStore;
  graph: ContextGraphSource;
  /** Reads the exact source lines for a symbol's span — no header/synthesis. */
  readSpan(path: string, startLine: number, endLine: number): string;
}

export interface AssembleOptions {
  /** Default 12,000 — docs/07 §6. */
  tokenBudget?: number;
  /** Pluggable so callers can swap in the active LLM's real tokenizer. */
  tokenCount?: (text: string) => number;
  callerDepth?: number;
  calleeDepth?: number;
}

export interface ContextBlock {
  citationId: string;
  symbolId: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  tokens: number;
}

export interface AssembledContext {
  blocks: ContextBlock[];
  totalTokens: number;
  budget: number;
  /** True if the budget ran out before every candidate symbol got a block. */
  truncated: boolean;
}

/** ~4 chars/token — a standard ballpark for English/code when no real tokenizer is wired in. */
export function heuristicTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Assembles token-budgeted context blocks (docs/07 §6) for a ranked list of
 * symbol ids: signature+doc (always), full code, caller/callee chains
 * (signatures only), then related files — in that priority order per symbol,
 * stopping the moment even the cheapest (signature+doc) block won't fit.
 * Full-code spans are deduplicated so the same lines never appear twice.
 */
export async function assembleContext(
  deps: ContextAssemblerDeps,
  repo: string,
  symbolIds: string[],
  options: AssembleOptions = {},
): Promise<AssembledContext> {
  const budget = options.tokenBudget ?? 12_000;
  const countTokens = options.tokenCount ?? heuristicTokenCount;
  const callerDepth = options.callerDepth ?? 2;
  const calleeDepth = options.calleeDepth ?? 2;

  const blocks: ContextBlock[] = [];
  const seenSpans = new Set<string>();
  let used = 0;
  let truncated = false;

  for (const symbolId of symbolIds) {
    const symbol = deps.store.getSymbol(symbolId);
    if (!symbol) continue;
    const { path } = parseSymbolId(symbolId);

    const header = `[S${String(blocks.length + 1)}] ${path}:${String(symbol.start_line)}-${String(symbol.end_line)}`;
    const sections = [header, signatureAndDoc(symbol)];
    let text = sections.join('\n');
    let tokens = countTokens(text);
    if (used + tokens > budget) {
      truncated = true;
      break;
    }

    const spanKey = `${path}:${String(symbol.start_line)}-${String(symbol.end_line)}`;
    if (!seenSpans.has(spanKey)) {
      const code = tryAppend(
        text,
        tokens,
        `\n\n${deps.readSpan(path, symbol.start_line, symbol.end_line)}`,
        budget - used,
        countTokens,
      );
      if (code) {
        text = code.text;
        tokens = code.tokens;
        seenSpans.add(spanKey);
      }
    }

    const callers = await deps.graph.callers(repo, symbolId, callerDepth);
    const callersText = renderHierarchy('Callers', callers, deps.store);
    if (callersText) {
      const withCallers = tryAppend(text, tokens, `\n\n${callersText}`, budget - used, countTokens);
      if (withCallers) ({ text, tokens } = withCallers);
    }

    const callees = await deps.graph.callees(repo, symbolId, calleeDepth);
    const calleesText = renderHierarchy('Callees', callees, deps.store);
    if (calleesText) {
      const withCallees = tryAppend(text, tokens, `\n\n${calleesText}`, budget - used, countTokens);
      if (withCallees) ({ text, tokens } = withCallees);
    }

    const relatedText = await renderRelatedFiles(deps, repo, symbolId, path);
    if (relatedText) {
      const withRelated = tryAppend(text, tokens, `\n\n${relatedText}`, budget - used, countTokens);
      if (withRelated) ({ text, tokens } = withRelated);
    }

    used += tokens;
    blocks.push({
      citationId: `S${String(blocks.length + 1)}`,
      symbolId,
      path,
      startLine: symbol.start_line,
      endLine: symbol.end_line,
      text,
      tokens,
    });
  }

  return { blocks, totalTokens: used, budget, truncated };
}

function signatureAndDoc(symbol: SymbolRow): string {
  const lines = [`signature: ${symbol.signature ?? symbol.qualified}`];
  if (symbol.doc) lines.push(`doc: ${symbol.doc}`);
  return lines.join('\n');
}

/** Appends `addition` to `text` only if it fits the remaining budget. */
function tryAppend(
  text: string,
  tokens: number,
  addition: string,
  remaining: number,
  countTokens: (t: string) => number,
): { text: string; tokens: number } | undefined {
  const additionTokens = countTokens(addition);
  if (additionTokens > remaining - tokens) return undefined;
  return { text: text + addition, tokens: tokens + additionTokens };
}

function renderHierarchy(label: string, entries: HierarchyEntry[], store: MetadataStore): string {
  if (entries.length === 0) return '';
  const rows = store.symbolsByIds(entries.map((e) => e.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lines = entries.map((e) => {
    const row = byId.get(e.id);
    const signature = row?.signature ?? e.name;
    return `- ${e.name} (${e.path ?? '?'}): ${signature}`;
  });
  return `${label}:\n${lines.join('\n')}`;
}

async function renderRelatedFiles(
  deps: ContextAssemblerDeps,
  repo: string,
  symbolId: string,
  path: string,
): Promise<string> {
  const allPaths = await deps.graph.filePaths(repo);
  const dir = dirname(path);
  const siblings = allPaths.filter((p) => p !== path && dirname(p) === dir);

  const fileId = `${repo}:${path}`;
  const { outgoing } = await deps.graph.neighbors(repo, fileId);
  const imports = outgoing
    .filter((n) => n.edge === 'IMPORTS' && n.path)
    .map((n) => n.path as string);

  if (siblings.length === 0 && imports.length === 0) return '';
  const lines = [`Related files (${path}):`];
  if (siblings.length > 0) lines.push(`- siblings: ${siblings.join(', ')}`);
  if (imports.length > 0) lines.push(`- imports: ${imports.join(', ')}`);
  return lines.join('\n');
}
