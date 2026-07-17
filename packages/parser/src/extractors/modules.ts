import type { ExportRecord, ImportRecord } from '@twograph/core';
import type { Node } from 'web-tree-sitter';
import type { ExtractionContext, Extractor } from '../registry.js';

const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'process',
  'stream',
  'url',
  'util',
  'worker_threads',
  'zlib',
]);

export function classifySource(source: string): ImportRecord['sourceType'] {
  if (source.startsWith('.') || source.startsWith('/')) return 'relative';
  if (source.startsWith('node:') || NODE_BUILTINS.has(source)) return 'builtin';
  return 'package';
}

function stringValue(node: Node | null): string | undefined {
  if (!node || node.type !== 'string') return undefined;
  return node.text.slice(1, -1);
}

function line(node: Node): number {
  return node.startPosition.row + 1;
}

function importSpecifiers(clause: Node): ImportRecord['specifiers'] {
  const specifiers: ImportRecord['specifiers'] = [];
  const walk = (node: Node): void => {
    if (node.type === 'identifier') {
      specifiers.push({ local: node.text, imported: 'default' });
      return;
    }
    if (node.type === 'namespace_import') {
      const local = node.namedChild(0)?.text;
      if (local) specifiers.push({ local, imported: '*' });
      return;
    }
    if (node.type === 'named_imports') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const spec = node.namedChild(i);
        if (spec?.type !== 'import_specifier') continue;
        const imported = spec.childForFieldName('name')?.text;
        const alias = spec.childForFieldName('alias')?.text;
        if (imported) specifiers.push({ local: alias ?? imported, imported });
      }
      return;
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) walk(child);
    }
  };
  walk(clause);
  return specifiers;
}

/**
 * Extracts import statements (static/dynamic/require/side-effect) and export
 * statements (named/default/re-export/star) — issue #15.
 */
export const modulesExtractor: Extractor = {
  id: 'modules',
  extract(ctx: ExtractionContext): void {
    const visit = (node: Node): void => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === 'import_statement') {
          const source = stringValue(child.childForFieldName('source'));
          if (source !== undefined) {
            const clause = child.namedChildren.find((n) => n?.type === 'import_clause');
            ctx.sink.imports.push({
              source,
              sourceType: classifySource(source),
              specifiers: clause ? importSpecifiers(clause) : [],
              kind: clause ? 'static' : 'sideEffect',
              line: line(child),
            });
          }
          continue;
        }

        if (child.type === 'call_expression') {
          const callee = child.childForFieldName('function');
          const args = child.childForFieldName('arguments');
          const firstArg = args?.namedChild(0) ?? null;
          const source = stringValue(firstArg);
          if (source !== undefined && callee) {
            if (callee.type === 'import') {
              ctx.sink.imports.push({
                source,
                sourceType: classifySource(source),
                specifiers: [],
                kind: 'dynamic',
                line: line(child),
              });
            } else if (callee.type === 'identifier' && callee.text === 'require') {
              ctx.sink.imports.push({
                source,
                sourceType: classifySource(source),
                specifiers: [],
                kind: 'require',
                line: line(child),
              });
            }
          }
          visit(child);
          continue;
        }

        if (child.type === 'export_statement') {
          extractExport(child);
          visit(child);
          continue;
        }

        visit(child);
      }
    };

    const extractExport = (node: Node): void => {
      const source = stringValue(node.childForFieldName('source'));
      const hasDefault = !!node.children.find((n) => n?.type === 'default');

      // export * from 'x'  (optionally `as ns`)
      if (node.children.some((n) => n?.type === '*' || n?.type === 'namespace_export')) {
        if (source !== undefined) {
          const record: ExportRecord = { name: '*', kind: 'star', source, line: line(node) };
          ctx.sink.exports.push(record);
        }
        return;
      }

      // export { a, b as c } [from 'x']
      const clause = node.namedChildren.find((n) => n?.type === 'export_clause');
      if (clause) {
        for (let i = 0; i < clause.namedChildCount; i++) {
          const spec = clause.namedChild(i);
          if (spec?.type !== 'export_specifier') continue;
          const local = spec.childForFieldName('name')?.text;
          const alias = spec.childForFieldName('alias')?.text;
          if (!local) continue;
          const record: ExportRecord = {
            name: alias ?? local,
            local,
            kind: source !== undefined ? 'reExport' : 'named',
            line: line(spec),
          };
          if (source !== undefined) record.source = source;
          ctx.sink.exports.push(record);
        }
        return;
      }

      // export [default] <declaration|expression>
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        const names: string[] = [];
        const nameField = declaration.childForFieldName('name')?.text;
        if (nameField) names.push(nameField);
        else if (
          declaration.type === 'lexical_declaration' ||
          declaration.type === 'variable_declaration'
        ) {
          for (let i = 0; i < declaration.namedChildCount; i++) {
            const d = declaration.namedChild(i);
            const n = d?.childForFieldName('name');
            if (n?.type === 'identifier') names.push(n.text);
          }
        }
        if (hasDefault) {
          const record: ExportRecord = { name: 'default', kind: 'default', line: line(node) };
          if (names[0] !== undefined) record.local = names[0];
          ctx.sink.exports.push(record);
        } else {
          for (const n of names) {
            ctx.sink.exports.push({ name: n, local: n, kind: 'named', line: line(node) });
          }
        }
        return;
      }

      if (hasDefault) {
        ctx.sink.exports.push({ name: 'default', kind: 'default', line: line(node) });
      }
    };

    visit(ctx.tree.rootNode);
  },
};
