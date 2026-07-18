import { formatSymbolId, hashContent, type CodeSymbol, type SymbolKind } from '@twograph/core';
import type { Node } from 'web-tree-sitter';
import type { ExtractionContext, Extractor } from '../registry.js';

const FUNCTION_DECLS = new Set(['function_declaration', 'generator_function_declaration']);
const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'generator_function']);
const VAR_DECLS = new Set(['lexical_declaration', 'variable_declaration']);

/** True when `node` is (transitively) wrapped in an export statement. */
export function isExported(node: Node): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'export_statement') return true;
    if (current.type === 'program') return false;
    // Stop at any nested scope: an export wrapper is always a direct chain.
    if (current.type.endsWith('_declaration') || current.type === 'variable_declarator') {
      current = current.parent;
      continue;
    }
    return false;
  }
  return false;
}

function span(node: Node): { startLine: number; endLine: number } {
  return { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

function signatureOf(source: string, node: Node): string {
  const body = node.childForFieldName('body');
  const end = body ? body.startIndex : node.endIndex;
  return source.slice(node.startIndex, end).replace(/\s+/g, ' ').trim();
}

export interface SymbolBuilderInput {
  ctx: ExtractionContext;
  node: Node;
  kind: SymbolKind;
  name: string;
  scope: readonly string[];
  signature?: string;
  exported: boolean;
  meta?: Record<string, unknown>;
}

/** Shared constructor for CodeSymbols — used by every extractor. */
export function buildSymbol(input: SymbolBuilderInput): CodeSymbol {
  const { ctx, node, kind, name, scope, signature, exported, meta } = input;
  const qualifiedName = [...scope, name].join('.');
  const symbol: CodeSymbol = {
    id: formatSymbolId({ repo: ctx.repo, path: ctx.path, qualifiedName }),
    repo: ctx.repo,
    path: ctx.path,
    kind,
    name,
    qualifiedName,
    span: span(node),
    exported,
    contentHash: hashContent(ctx.source.slice(node.startIndex, node.endIndex)),
    meta: meta ?? {},
  };
  if (signature !== undefined) symbol.signature = signature;
  return symbol;
}

function functionMeta(node: Node): Record<string, unknown> {
  const text = node.text;
  return {
    async: /^async\b/.test(text) || node.firstChild?.type === 'async',
    generator: node.type.includes('generator') || text.startsWith('function*'),
    arrow: node.type === 'arrow_function',
  };
}

/**
 * Extracts function declarations, named arrow/function expressions bound to
 * variables, and module-level variables (FR-2.2, issue #12 scope).
 * Maintains a scope stack so nested functions get parent-qualified IDs.
 */
export const symbolsExtractor: Extractor = {
  id: 'symbols',
  extract(ctx: ExtractionContext): void {
    const seen = new Set<string>();

    const visit = (node: Node, scope: readonly string[], moduleLevel: boolean): void => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (FUNCTION_DECLS.has(child.type)) {
          const name = child.childForFieldName('name')?.text;
          if (name) {
            push(
              buildSymbol({
                ctx,
                node: child,
                kind: 'function',
                name,
                scope,
                signature: signatureOf(ctx.source, child),
                exported: isExported(child),
                meta: functionMeta(child),
              }),
            );
            visit(child, [...scope, name], false);
            continue;
          }
        }

        if (VAR_DECLS.has(child.type)) {
          for (let j = 0; j < child.namedChildCount; j++) {
            const declarator = child.namedChild(j);
            if (declarator?.type !== 'variable_declarator') continue;
            const nameNode = declarator.childForFieldName('name');
            const value = declarator.childForFieldName('value');
            if (!nameNode || nameNode.type !== 'identifier') continue;
            const name = nameNode.text;

            if (value && FUNCTION_VALUES.has(value.type)) {
              push(
                buildSymbol({
                  ctx,
                  node: declarator,
                  kind: 'function',
                  name,
                  scope,
                  signature: signatureOf(ctx.source, value).replace(
                    /^/,
                    `${child.firstChild?.text ?? 'const'} ${name} = `,
                  ),
                  exported: isExported(declarator),
                  meta: functionMeta(value),
                }),
              );
              visit(value, [...scope, name], false);
              continue;
            }

            if (moduleLevel) {
              push(
                buildSymbol({
                  ctx,
                  node: declarator,
                  kind: 'variable',
                  name,
                  scope,
                  exported: isExported(declarator),
                  meta: { varKind: child.firstChild?.text ?? 'var' },
                }),
              );
            }
            if (value) visit(value, scope, false);
          }
          continue;
        }

        // Do not descend into class bodies here (issue #13 handles them),
        // but keep walking everything else so nested/exported wrappers are seen.
        const nextModuleLevel =
          moduleLevel && (child.type === 'export_statement' || child.type === 'program');
        visit(child, scope, nextModuleLevel);
      }
    };

    const push = (symbol: CodeSymbol): void => {
      if (seen.has(symbol.id)) return;
      seen.add(symbol.id);
      ctx.sink.symbols.push(symbol);
    };

    visit(ctx.tree.rootNode, [], true);
  },
};
