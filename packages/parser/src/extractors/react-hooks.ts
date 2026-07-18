import type { CodeSymbol } from '@twograph/core';
import type { Node } from 'web-tree-sitter';
import type { ExtractionContext, Extractor } from '../registry.js';

const BUILTIN_HOOKS = new Set([
  'useState',
  'useEffect',
  'useContext',
  'useReducer',
  'useMemo',
  'useCallback',
  'useRef',
  'useLayoutEffect',
  'useInsertionEffect',
  'useId',
  'useTransition',
  'useDeferredValue',
  'useSyncExternalStore',
  'useImperativeHandle',
  'useDebugValue',
  'useOptimistic',
  'useActionState',
]);

const isHookName = (name: string): boolean => /^use[A-Z0-9]/.test(name);

/** Whether a hook name is a React built-in (custom hooks get USES_HOOK edges). */
export const isBuiltinHook = (name: string): boolean => BUILTIN_HOOKS.has(name);

/**
 * Post-pass for React state architecture (issue #18):
 * - custom `use*` functions become kind `hook` (builtin flag on meta)
 * - per-symbol hook calls recorded as `hook` references + meta.hooksUsed
 * - `createContext` variables become kind `context`
 * - `useContext(X)` → meta.consumesContexts; `<X.Provider>` → meta.providesContexts
 * - `useReducer(fn, …)` → meta.reducers + read reference to the reducer fn
 * Must run after symbols/classes/react-components extractors.
 */
export const reactHooksExtractor: Extractor = {
  id: 'react-hooks',
  extract(ctx: ExtractionContext): void {
    const byQualified = new Map<string, CodeSymbol>();
    for (const s of ctx.sink.symbols) byQualified.set(s.qualifiedName, s);

    // 1) Upgrade custom hooks and createContext variables.
    for (const symbol of ctx.sink.symbols) {
      if (symbol.kind === 'function' && isHookName(symbol.name)) {
        symbol.kind = 'hook';
        symbol.meta = { ...symbol.meta, builtin: false };
      }
    }

    const perSymbol = new Map<
      string,
      { hooks: Set<string>; consumes: Set<string>; reducers: Set<string> }
    >();
    const bucket = (qualified: string) => {
      let entry = perSymbol.get(qualified);
      if (!entry) {
        entry = { hooks: new Set(), consumes: new Set(), reducers: new Set() };
        perSymbol.set(qualified, entry);
      }
      return entry;
    };

    const visit = (node: Node, scope: readonly string[]): void => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === 'function_declaration') {
          const name = child.childForFieldName('name')?.text;
          visit(child, name ? [...scope, name] : scope);
          continue;
        }

        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          const name = nameNode?.type === 'identifier' ? nameNode.text : undefined;
          const value = child.childForFieldName('value');
          if (name && value?.type === 'call_expression') {
            const callee = value.childForFieldName('function')?.text.replace(/^React\./, '');
            if (callee === 'createContext') {
              const symbol = byQualified.get([...scope, name].join('.'));
              if (symbol) symbol.kind = 'context';
            }
          }
          // Only function-valued declarators open a new naming scope; extending
          // for destructuring patterns or plain values mis-attributes hook calls.
          const opensScope =
            name && (value?.type === 'arrow_function' || value?.type === 'function_expression');
          visit(child, opensScope ? [...scope, name] : scope);
          continue;
        }

        if (child.type === 'call_expression') {
          const calleeNode = child.childForFieldName('function');
          const callee = calleeNode?.text.replace(/^React\./, '');
          if (callee && isHookName(callee) && scope.length > 0) {
            const from = scope.join('.');
            bucket(from).hooks.add(callee);
            ctx.sink.references.push({
              from,
              name: callee,
              kind: 'hook',
              line: child.startPosition.row + 1,
              imported: false,
            });
            const firstArg = child.childForFieldName('arguments')?.namedChild(0);
            if (callee === 'useContext' && firstArg?.type === 'identifier') {
              bucket(from).consumes.add(firstArg.text);
              ctx.sink.references.push({
                from,
                name: firstArg.text,
                kind: 'read',
                line: firstArg.startPosition.row + 1,
                imported: false,
              });
            }
            if (callee === 'useReducer' && firstArg?.type === 'identifier') {
              bucket(from).reducers.add(firstArg.text);
              ctx.sink.references.push({
                from,
                name: firstArg.text,
                kind: 'read',
                line: firstArg.startPosition.row + 1,
                imported: false,
              });
            }
          }
          visit(child, scope);
          continue;
        }

        visit(child, scope);
      }
    };
    visit(ctx.tree.rootNode, []);

    // 2) Fold collected usage into symbol meta.
    for (const [qualified, usage] of perSymbol) {
      const symbol = byQualified.get(qualified);
      if (!symbol) continue;
      symbol.meta = {
        ...symbol.meta,
        hooksUsed: [...usage.hooks],
        customHooksUsed: [...usage.hooks].filter((h) => !isBuiltinHook(h)),
        ...(usage.consumes.size > 0 ? { consumesContexts: [...usage.consumes] } : {}),
        ...(usage.reducers.size > 0 ? { reducers: [...usage.reducers] } : {}),
      };
    }

    // 3) Providers: jsxUsage tags ending in `.Provider`.
    for (const symbol of ctx.sink.symbols) {
      const jsx = symbol.meta['jsxUsage'];
      if (!jsx || typeof jsx !== 'object') continue;
      const provides = Object.keys(jsx)
        .filter((tag) => tag.endsWith('.Provider'))
        .map((tag) => tag.slice(0, -'.Provider'.length));
      if (provides.length > 0) {
        symbol.meta = { ...symbol.meta, providesContexts: provides };
      }
    }
  },
};
