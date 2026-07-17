import type { CodeSymbol } from '@twograph/core';
import type { Node } from 'web-tree-sitter';
import type { ExtractionContext, Extractor } from '../registry.js';

const JSX_NODES = new Set(['jsx_element', 'jsx_self_closing_element', 'jsx_fragment']);
const WRAPPERS = new Set(['memo', 'forwardRef']);

function isCapitalized(name: string): boolean {
  const first = name.charAt(0);
  return first !== '' && first === first.toUpperCase() && first !== first.toLowerCase();
}

function containsJsx(node: Node): boolean {
  if (JSX_NODES.has(node.type)) return true;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && containsJsx(child)) return true;
  }
  return false;
}

/** Collects capitalized JSX tag usage (and member tags like Ctx.Provider) with counts. */
function jsxUsage(node: Node, acc: Map<string, { count: number; line: number }>): void {
  if (node.type === 'jsx_self_closing_element' || node.type === 'jsx_opening_element') {
    const nameNode = node.childForFieldName('name');
    const tag = nameNode?.text;
    if (tag && (isCapitalized(tag) || tag.includes('.'))) {
      const existing = acc.get(tag);
      if (existing) existing.count += 1;
      else acc.set(tag, { count: 1, line: node.startPosition.row + 1 });
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) jsxUsage(child, acc);
  }
}

/** Prop names from a destructured first parameter + declared props type text. */
function propsOf(fnNode: Node): { props: string[]; propsType?: string } {
  const params = fnNode.childForFieldName('parameters') ?? fnNode.childForFieldName('parameter');
  const first = params?.namedChild(0);
  if (!first) return { props: [] };
  const pattern = first.type === 'object_pattern' ? first : first.childForFieldName('pattern');
  const props: string[] = [];
  const collect = (node: Node): void => {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;
      if (child.type === 'shorthand_property_identifier_pattern') props.push(child.text);
      else if (child.type === 'pair_pattern') {
        const key = child.childForFieldName('key')?.text;
        if (key) props.push(key);
      } else if (child.type === 'rest_pattern') props.push(`...${child.namedChild(0)?.text ?? ''}`);
      else if (child.type === 'object_assignment_pattern') {
        const left = child.namedChild(0);
        if (left?.type === 'shorthand_property_identifier_pattern') props.push(left.text);
      }
    }
  };
  if (pattern?.type === 'object_pattern') collect(pattern);
  const typeNode =
    first.childForFieldName('type') ??
    (first.type === 'required_parameter' || first.type === 'optional_parameter'
      ? first.namedChildren.find((n) => n?.type === 'type_annotation')
      : undefined);
  const result: { props: string[]; propsType?: string } = { props };
  const typeText = typeNode?.text.replace(/^:\s*/, '');
  if (typeText) result.propsType = typeText;
  return result;
}

/** Innermost function inside memo(forwardRef(fn)) chains. */
function unwrap(call: Node): { fn: Node | null; wrappers: string[] } {
  const wrappers: string[] = [];
  let current: Node | null = call;
  while (current && current.type === 'call_expression') {
    const callee = current.childForFieldName('function');
    const calleeName = callee?.text.replace(/^React\./, '') ?? '';
    if (!WRAPPERS.has(calleeName)) break;
    wrappers.push(calleeName);
    const arg: Node | null = current.childForFieldName('arguments')?.namedChild(0) ?? null;
    if (arg && (arg.type === 'arrow_function' || arg.type === 'function_expression')) {
      return { fn: arg, wrappers };
    }
    current = arg;
  }
  return { fn: null, wrappers };
}

function extendsReactComponent(classNode: Node): boolean {
  for (let i = 0; i < classNode.childCount; i++) {
    const heritage = classNode.child(i);
    if (heritage?.type !== 'class_heritage') continue;
    return /(React\.)?(Pure)?Component/.test(heritage.text);
  }
  return false;
}

/**
 * Detects React components (function/class/memo/forwardRef), upgrading the
 * symbols produced by earlier extractors and recording per-component JSX
 * usage + props (issue #17). Must run after symbols/classes extractors.
 */
export const reactComponentsExtractor: Extractor = {
  id: 'react-components',
  extract(ctx: ExtractionContext): void {
    const byQualified = new Map<string, CodeSymbol>();
    for (const s of ctx.sink.symbols) byQualified.set(s.qualifiedName, s);

    const upgrade = (
      qualifiedName: string,
      componentKind: string,
      renderFn: Node | null,
      componentNode: Node,
    ): void => {
      const symbol = byQualified.get(qualifiedName);
      if (!symbol) return;
      symbol.kind = 'component';
      const usage = new Map<string, { count: number; line: number }>();
      jsxUsage(componentNode, usage);
      const propInfo = renderFn ? propsOf(renderFn) : { props: [] };
      symbol.meta = {
        ...symbol.meta,
        componentKind,
        props: propInfo.props,
        ...(propInfo.propsType ? { propsType: propInfo.propsType } : {}),
        jsxUsage: Object.fromEntries([...usage.entries()].map(([k, v]) => [k, v.count])),
      };
      for (const [tag, info] of usage) {
        ctx.sink.references.push({
          from: qualifiedName,
          name: tag,
          kind: 'jsx',
          line: info.line,
          imported: false,
        });
      }
    };

    const visit = (node: Node, scope: readonly string[]): void => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === 'function_declaration') {
          const name = child.childForFieldName('name')?.text;
          if (name && isCapitalized(name) && containsJsx(child)) {
            upgrade([...scope, name].join('.'), 'function', child, child);
          }
          if (name) visit(child, [...scope, name]);
          else visit(child, scope);
          continue;
        }

        if (child.type === 'variable_declarator') {
          const name = child.childForFieldName('name')?.text;
          const value = child.childForFieldName('value');
          if (name && value && isCapitalized(name)) {
            if (
              (value.type === 'arrow_function' || value.type === 'function_expression') &&
              containsJsx(value)
            ) {
              upgrade([...scope, name].join('.'), 'function', value, value);
            } else if (value.type === 'call_expression') {
              const { fn, wrappers } = unwrap(value);
              if (fn && containsJsx(fn)) {
                upgrade([...scope, name].join('.'), wrappers[0] ?? 'function', fn, fn);
              }
            }
          }
          visit(child, name ? [...scope, name] : scope);
          continue;
        }

        if (
          (child.type === 'class_declaration' || child.type === 'abstract_class_declaration') &&
          extendsReactComponent(child)
        ) {
          const name = child.childForFieldName('name')?.text;
          if (name) upgrade([...scope, name].join('.'), 'class', null, child);
          visit(child, name ? [...scope, name] : scope);
          continue;
        }

        visit(child, scope);
      }
    };

    visit(ctx.tree.rootNode, []);
  },
};
