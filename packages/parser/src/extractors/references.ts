import type { Node } from 'web-tree-sitter';
import type { ExtractionContext, Extractor } from '../registry.js';

const FUNCTION_NODES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'arrow_function',
  'function_expression',
  'method_definition',
]);

/** Names declared directly in a function (params + own-body vars), not in nested fns. */
function ownDeclarations(fnNode: Node): Set<string> {
  const names = new Set<string>();
  const collectPattern = (node: Node): void => {
    if (node.type === 'identifier' || node.type === 'shorthand_property_identifier_pattern') {
      names.add(node.text);
      return;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) collectPattern(child);
    }
  };
  const params = fnNode.childForFieldName('parameters') ?? fnNode.childForFieldName('parameter');
  if (params) collectPattern(params);

  const walkBody = (node: Node): void => {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;
      if (FUNCTION_NODES.has(child.type)) {
        // Nested function: its name is visible here, its internals are not.
        const name = child.childForFieldName('name')?.text;
        if (name) names.add(name);
        continue;
      }
      if (child.type === 'variable_declarator') {
        const nameNode = child.childForFieldName('name');
        if (nameNode) collectPattern(nameNode);
      }
      walkBody(child);
    }
  };
  const body = fnNode.childForFieldName('body');
  if (body) walkBody(body);
  return names;
}

/**
 * Records call expressions and module-variable reads/writes with their
 * enclosing symbol, respecting lexical shadowing (issue #20). Imported names
 * are flagged so the cross-file resolution pass (#21) can link them.
 */
export const referencesExtractor: Extractor = {
  id: 'references',
  extract(ctx: ExtractionContext): void {
    const moduleVars = new Set(
      ctx.sink.symbols
        .filter((s) => s.kind === 'variable' || s.kind === 'context')
        .map((s) => s.name),
    );
    const importBindings = new Set(
      ctx.sink.imports.flatMap((imp) => imp.specifiers.map((s) => s.local)),
    );
    const seen = new Set<string>();

    type Frame = Set<string>;
    const frames: Frame[] = [];
    const isShadowed = (name: string): boolean => frames.some((f) => f.has(name));

    const record = (
      from: string | undefined,
      name: string,
      kind: 'call' | 'read' | 'write',
      line: number,
    ): void => {
      const base = name.split('.')[0] ?? name;
      const key = `${from ?? ''}|${name}|${kind}|${String(line)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const imported = importBindings.has(base) && !isShadowed(base);
      const ref: {
        from?: string;
        name: string;
        kind: 'call' | 'read' | 'write';
        line: number;
        imported: boolean;
      } = { name, kind, line, imported };
      if (from !== undefined) ref.from = from;
      ctx.sink.references.push(ref);
    };

    const calleeName = (callee: Node): string | undefined => {
      // Wrappers the grammar folds into the callee: generics (instantiation),
      // `await fn(...)` (await binds inside call_expression), parens.
      if (
        callee.type === 'instantiation_expression' ||
        callee.type === 'await_expression' ||
        callee.type === 'parenthesized_expression'
      ) {
        const inner = callee.namedChild(0);
        return inner ? calleeName(inner) : undefined;
      }
      if (callee.type === 'identifier') return callee.text;
      if (callee.type === 'member_expression') {
        // Keep the chain text, but ignore computed access / call results.
        if (/^[\w$]+(\.[\w$]+)+$/.test(callee.text) || callee.text.startsWith('this.')) {
          return callee.text;
        }
        return undefined;
      }
      return undefined;
    };

    const fromOf = (scope: readonly string[]): string | undefined =>
      scope.length > 0 ? scope.join('.') : undefined;

    const children = (node: Node, scope: readonly string[]): void => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) process(child, scope);
      }
    };

    const process = (node: Node, scope: readonly string[]): void => {
      if (node.type === 'import_statement' || node.type === 'export_clause') return;

      if (FUNCTION_NODES.has(node.type)) {
        const name = node.childForFieldName('name')?.text;
        frames.push(ownDeclarations(node));
        children(node, name ? [...scope, name] : scope);
        frames.pop();
        return;
      }

      if (node.type === 'class_declaration' || node.type === 'abstract_class_declaration') {
        const name = node.childForFieldName('name')?.text;
        children(node, name ? [...scope, name] : scope);
        return;
      }

      if (node.type === 'variable_declarator') {
        const nameNode = node.childForFieldName('name');
        const value = node.childForFieldName('value');
        if (!value) return;
        const isFnValue = value.type === 'arrow_function' || value.type === 'function_expression';
        if (isFnValue && nameNode?.type === 'identifier') {
          frames.push(ownDeclarations(value));
          children(value, [...scope, nameNode.text]);
          frames.pop();
        } else {
          process(value, scope);
        }
        return;
      }

      if (node.type === 'call_expression') {
        const callee = node.childForFieldName('function');
        const name = callee ? calleeName(callee) : undefined;
        if (name && name !== 'require' && name !== 'import') {
          record(fromOf(scope), name, 'call', node.startPosition.row + 1);
        }
        // Walk arguments and computed callees for nested calls/reads.
        const args = node.childForFieldName('arguments');
        if (args) children(args, scope);
        if (callee && !name) process(callee, scope);
        return;
      }

      if (
        node.type === 'assignment_expression' ||
        node.type === 'augmented_assignment_expression'
      ) {
        const left = node.childForFieldName('left');
        if (left?.type === 'identifier' && moduleVars.has(left.text) && !isShadowed(left.text)) {
          record(fromOf(scope), left.text, 'write', left.startPosition.row + 1);
        }
        const right = node.childForFieldName('right');
        if (right) process(right, scope);
        return;
      }

      if (node.type === 'update_expression') {
        const arg = node.namedChild(0);
        if (arg?.type === 'identifier' && moduleVars.has(arg.text) && !isShadowed(arg.text)) {
          record(fromOf(scope), arg.text, 'write', arg.startPosition.row + 1);
        }
        return;
      }

      if (node.type === 'identifier') {
        if (moduleVars.has(node.text) && !isShadowed(node.text)) {
          record(fromOf(scope), node.text, 'read', node.startPosition.row + 1);
        }
        return;
      }

      children(node, scope);
    };

    process(ctx.tree.rootNode, []);
  },
};
