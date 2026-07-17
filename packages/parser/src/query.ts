import { Query, type Language, type Node, type Tree } from 'web-tree-sitter';

export interface CaptureHit {
  readonly name: string;
  readonly node: Node;
}

/** Compiled-query cache keyed by language + source. */
const cache = new WeakMap<Language, Map<string, Query>>();

/** Runs a tree-sitter query over a tree and returns its captures in document order. */
export function captures(language: Language, tree: Tree, querySource: string): CaptureHit[] {
  let byQuery = cache.get(language);
  if (!byQuery) {
    byQuery = new Map();
    cache.set(language, byQuery);
  }
  let query = byQuery.get(querySource);
  if (!query) {
    query = new Query(language, querySource);
    byQuery.set(querySource, query);
  }
  return query.captures(tree.rootNode).map((c) => ({ name: c.name, node: c.node }));
}

/** 1-based line span of a node (tree-sitter rows are 0-based). */
export function nodeSpan(node: Node): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** Node text helper (web-tree-sitter keeps source on the node). */
export function text(node: Node): string {
  return node.text;
}
