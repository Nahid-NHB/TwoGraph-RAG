import type { ReferenceRecord } from '@twograph/core';
import type { Node } from 'web-tree-sitter';
import type { ExtractionContext, Extractor } from '../registry.js';
import { buildSymbol, isExported } from './symbols.js';

const METHOD_NODES = new Set(['method_definition', 'abstract_method_signature']);

function signatureOf(source: string, node: Node): string {
  const body = node.childForFieldName('body');
  const end = body ? body.startIndex : node.endIndex;
  return source.slice(node.startIndex, end).replace(/\s+/g, ' ').trim();
}

/** Leading modifier tokens of a class member (static/async/accessibility/abstract). */
function memberModifiers(node: Node): { static: boolean; visibility: string; async: boolean } {
  let isStatic = false;
  let visibility = 'public';
  let isAsync = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === 'property_identifier' || child.type === 'formal_parameters') break;
    if (child.type === 'static') isStatic = true;
    if (child.type === 'async') isAsync = true;
    if (child.type === 'accessibility_modifier') visibility = child.text;
  }
  return { static: isStatic, visibility, async: isAsync };
}

/** Collects identifier names inside an extends/implements clause. */
function heritageNames(clause: Node): { name: string; line: number }[] {
  const names: { name: string; line: number }[] = [];
  const walk = (node: Node): void => {
    if (
      node.type === 'identifier' ||
      node.type === 'type_identifier' ||
      node.type === 'nested_type_identifier' ||
      node.type === 'member_expression'
    ) {
      names.push({ name: node.text, line: node.startPosition.row + 1 });
      return;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) walk(child);
    }
  };
  for (let i = 0; i < clause.namedChildCount; i++) {
    const child = clause.namedChild(i);
    if (child) walk(child);
  }
  return names;
}

/**
 * Extracts classes, their methods (with modifiers), and inheritance references
 * (`extends`/`implements`) for the graph resolution pass (issue #13).
 */
export const classesExtractor: Extractor = {
  id: 'classes',
  extract(ctx: ExtractionContext): void {
    const visit = (node: Node, scope: readonly string[]): void => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        if (child.type === 'class_declaration' || child.type === 'abstract_class_declaration') {
          extractClass(child, scope);
          continue;
        }
        visit(child, scope);
      }
    };

    const extractClass = (classNode: Node, scope: readonly string[]): void => {
      const name = classNode.childForFieldName('name')?.text;
      if (!name) return;
      const abstract =
        classNode.type === 'abstract_class_declaration' ||
        classNode.firstChild?.type === 'abstract';

      ctx.sink.symbols.push(
        buildSymbol({
          ctx,
          node: classNode,
          kind: 'class',
          name,
          scope,
          signature: signatureOf(ctx.source, classNode),
          exported: isExported(classNode),
          meta: { abstract },
        }),
      );

      for (let i = 0; i < classNode.childCount; i++) {
        const heritage = classNode.child(i);
        if (heritage?.type !== 'class_heritage') continue;
        // TS grammar nests extends_clause/implements_clause; JS grammar puts
        // the expression directly under class_heritage (extends only).
        let sawClause = false;
        for (let j = 0; j < heritage.namedChildCount; j++) {
          const clause = heritage.namedChild(j);
          if (!clause) continue;
          if (clause.type === 'extends_clause' || clause.type === 'implements_clause') {
            sawClause = true;
            const kind = clause.type === 'extends_clause' ? 'extends' : 'implements';
            for (const ref of heritageNames(clause)) pushHeritage(name, ref, kind);
          }
        }
        if (!sawClause) {
          for (const ref of heritageNames(heritage)) pushHeritage(name, ref, 'extends');
        }
      }

      const body = classNode.childForFieldName('body');
      if (!body) return;
      for (let i = 0; i < body.namedChildCount; i++) {
        const member = body.namedChild(i);
        if (!member || !METHOD_NODES.has(member.type)) continue;
        const methodName = member.childForFieldName('name')?.text;
        if (!methodName) continue;
        const mods = memberModifiers(member);
        ctx.sink.symbols.push(
          buildSymbol({
            ctx,
            node: member,
            kind: 'method',
            name: methodName,
            scope: [...scope, name],
            signature: signatureOf(ctx.source, member),
            exported: false,
            meta: {
              static: mods.static,
              visibility: mods.visibility,
              async: mods.async,
              abstract: member.type === 'abstract_method_signature',
            },
          }),
        );
      }
    };

    const pushHeritage = (
      className: string,
      ref: { name: string; line: number },
      kind: 'extends' | 'implements',
    ): void => {
      const record: ReferenceRecord = {
        from: className,
        name: ref.name,
        kind,
        line: ref.line,
        imported: false,
      };
      ctx.sink.references.push(record);
    };

    visit(ctx.tree.rootNode, []);
  },
};
