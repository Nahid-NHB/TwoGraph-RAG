import type { Node } from 'web-tree-sitter';
import type { ExtractionContext, Extractor } from '../registry.js';
import { buildSymbol } from './symbols.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']);

/** Route patterns may contain chars illegal in symbol IDs (`:`); sanitize for naming. */
function routeName(method: string | undefined, pattern: string): string {
  const safe = pattern.replaceAll(':', '$');
  return method ? `${method.toUpperCase()} ${safe}` : safe;
}

/** A framework-specific detector contributing Route/Api records (docs/09 §8). */
export interface RouteDetector {
  id: string;
  detect(ctx: ExtractionContext): void;
}

/** Express/Fastify style: app.get('/path', handler) registrations. */
export const expressDetector: RouteDetector = {
  id: 'express',
  detect(ctx) {
    const visit = (node: Node): void => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (child.type === 'call_expression') {
          const callee = child.childForFieldName('function');
          if (callee?.type === 'member_expression') {
            const method = callee.childForFieldName('property')?.text;
            const args = child.childForFieldName('arguments');
            const first = args?.namedChild(0);
            if (method && HTTP_METHODS.has(method) && first?.type === 'string') {
              const pattern = first.text.slice(1, -1);
              if (pattern.startsWith('/')) {
                const name = routeName(method, pattern);
                ctx.sink.symbols.push(
                  buildSymbol({
                    ctx,
                    node: child,
                    kind: 'route',
                    name,
                    scope: [],
                    exported: false,
                    meta: {
                      framework: 'express',
                      routePattern: pattern,
                      method: method.toUpperCase(),
                    },
                  }),
                );
                for (let a = 1; a < (args?.namedChildCount ?? 0); a++) {
                  const handler = args?.namedChild(a);
                  if (handler?.type === 'identifier') {
                    ctx.sink.references.push({
                      from: name,
                      name: handler.text,
                      kind: 'call',
                      line: handler.startPosition.row + 1,
                      imported: false,
                    });
                  }
                }
              }
            }
          }
        }
        visit(child);
      }
    };
    visit(ctx.tree.rootNode);
  },
};

/** React Router style: <Route path="/x" element={<Comp/>} /> */
export const reactRouterDetector: RouteDetector = {
  id: 'react-router',
  detect(ctx) {
    const visit = (node: Node): void => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (child.type === 'jsx_self_closing_element' || child.type === 'jsx_opening_element') {
          if (child.childForFieldName('name')?.text === 'Route') {
            let pattern: string | undefined;
            let elementComponent: string | undefined;
            let line = child.startPosition.row + 1;
            for (let j = 0; j < child.namedChildCount; j++) {
              const attr = child.namedChild(j);
              if (attr?.type !== 'jsx_attribute') continue;
              const attrName = attr.namedChild(0)?.text;
              const value = attr.namedChild(1);
              if (attrName === 'path' && value?.type === 'string') {
                pattern = value.text.slice(1, -1);
                line = attr.startPosition.row + 1;
              }
              if (attrName === 'element' && value) {
                const inner = value.namedChild(0);
                const tag =
                  inner?.type === 'jsx_self_closing_element' || inner?.type === 'jsx_element'
                    ? (inner.childForFieldName('name') ??
                      inner.namedChild(0)?.childForFieldName('name'))
                    : null;
                elementComponent = tag?.text;
              }
            }
            if (pattern) {
              const name = routeName(undefined, pattern);
              ctx.sink.symbols.push(
                buildSymbol({
                  ctx,
                  node: child,
                  kind: 'route',
                  name,
                  scope: [],
                  exported: false,
                  meta: { framework: 'react-router', routePattern: pattern },
                }),
              );
              if (elementComponent) {
                ctx.sink.references.push({
                  from: name,
                  name: elementComponent,
                  kind: 'call',
                  line,
                  imported: false,
                });
              }
            }
          }
        }
        visit(child);
      }
    };
    visit(ctx.tree.rootNode);
  },
};

/** Next.js file conventions: app router page/route files and pages/ files. */
export const nextDetector: RouteDetector = {
  id: 'next',
  detect(ctx) {
    const path = ctx.path;
    let pattern: string | undefined;
    const appMatch = /(?:^|\/)app\/(.*?)(?:\/)?(page|route)\.[jt]sx?$/.exec(path);
    if (appMatch)
      pattern = `/${(appMatch[1] ?? '').replace(/\(.*?\)\//g, '')}`.replace(/\/$/, '') || '/';
    const pagesMatch = /(?:^|\/)pages\/(.*)\.[jt]sx?$/.exec(path);
    if (!pattern && pagesMatch) {
      const rel = (pagesMatch[1] ?? '').replace(/\/?index$/, '');
      if (!rel.startsWith('_') && !rel.startsWith('api/_')) pattern = rel ? `/${rel}` : '/';
    }
    if (!pattern) return;
    const name = routeName(undefined, pattern.replaceAll('[', '$').replaceAll(']', ''));
    ctx.sink.symbols.push(
      buildSymbol({
        ctx,
        node: ctx.tree.rootNode,
        kind: 'route',
        name,
        scope: [],
        exported: false,
        meta: { framework: 'next', routePattern: pattern },
      }),
    );
  },
};

/** Aggregates all registered route detectors (issue #19). */
export const routesExtractor: Extractor & { detectors: RouteDetector[] } = {
  id: 'routes',
  detectors: [expressDetector, reactRouterDetector, nextDetector],
  extract(ctx: ExtractionContext): void {
    for (const detector of routesExtractor.detectors) detector.detect(ctx);
  },
};
