import type { Extractor } from '../registry.js';
import { classesExtractor } from './classes.js';
import { docsExtractor } from './docs.js';
import { modulesExtractor } from './modules.js';
import { reactComponentsExtractor } from './react-components.js';
import { reactHooksExtractor } from './react-hooks.js';
import { routesExtractor } from './routes.js';
import { symbolsExtractor } from './symbols.js';
import { typesExtractor } from './types.js';

export { buildSymbol, isExported, symbolsExtractor } from './symbols.js';
export { classesExtractor } from './classes.js';
export { typesExtractor } from './types.js';
export { classifySource, modulesExtractor } from './modules.js';
export { docsExtractor, parseJsdoc } from './docs.js';
export { reactComponentsExtractor } from './react-components.js';
export { isBuiltinHook, reactHooksExtractor } from './react-hooks.js';
export {
  expressDetector,
  nextDetector,
  reactRouterDetector,
  routesExtractor,
  type RouteDetector,
} from './routes.js';

/** The standard extractor set. Order matters: react upgrades symbols from the
 * extractors before it; docsExtractor attaches to everything last. */
export function defaultExtractors(): Extractor[] {
  return [
    symbolsExtractor,
    classesExtractor,
    typesExtractor,
    modulesExtractor,
    reactComponentsExtractor,
    reactHooksExtractor,
    routesExtractor,
    docsExtractor,
  ];
}
