import type { Node } from 'web-tree-sitter';
import type { ExtractionContext, Extractor } from '../registry.js';
import { buildSymbol, isExported } from './symbols.js';

/** Member names of an interface/enum body (for meta summaries). */
function memberNames(body: Node | null): string[] {
  if (!body) return [];
  const names: string[] = [];
  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i);
    if (!member) continue;
    // Enum bodies list bare property_identifiers; other bodies use a name field.
    const name =
      member.childForFieldName('name')?.text ??
      (member.type === 'property_identifier' ? member.text : undefined);
    if (name) names.push(name);
  }
  return names;
}

/**
 * Extracts TypeScript type entities: interfaces (with extends references),
 * enums (const flag + members), and type aliases (issue #14).
 */
export const typesExtractor: Extractor = {
  id: 'types',
  extract(ctx: ExtractionContext): void {
    const visit = (node: Node, scope: readonly string[]): void => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === 'interface_declaration') {
          const name = child.childForFieldName('name')?.text;
          if (name) {
            ctx.sink.symbols.push(
              buildSymbol({
                ctx,
                node: child,
                kind: 'interface',
                name,
                scope,
                exported: isExported(child),
                meta: { members: memberNames(child.childForFieldName('body')) },
              }),
            );
            for (let j = 0; j < child.namedChildCount; j++) {
              const clause = child.namedChild(j);
              if (clause?.type !== 'extends_type_clause') continue;
              for (let k = 0; k < clause.namedChildCount; k++) {
                const target = clause.namedChild(k);
                if (!target) continue;
                ctx.sink.references.push({
                  from: name,
                  name: target.text,
                  kind: 'extends',
                  line: target.startPosition.row + 1,
                  imported: false,
                });
              }
            }
          }
          continue;
        }

        if (child.type === 'enum_declaration') {
          const name = child.childForFieldName('name')?.text;
          if (name) {
            ctx.sink.symbols.push(
              buildSymbol({
                ctx,
                node: child,
                kind: 'enum',
                name,
                scope,
                exported: isExported(child),
                meta: {
                  const: child.firstChild?.type === 'const',
                  members: memberNames(child.childForFieldName('body')),
                },
              }),
            );
          }
          continue;
        }

        if (child.type === 'type_alias_declaration') {
          const name = child.childForFieldName('name')?.text;
          if (name) {
            const value = child.childForFieldName('value');
            ctx.sink.symbols.push(
              buildSymbol({
                ctx,
                node: child,
                kind: 'typeAlias',
                name,
                scope,
                signature: `type ${name} = ${value ? value.text.replace(/\s+/g, ' ') : 'unknown'}`,
                exported: isExported(child),
              }),
            );
          }
          continue;
        }

        visit(child, scope);
      }
    };

    visit(ctx.tree.rootNode, []);
  },
};
