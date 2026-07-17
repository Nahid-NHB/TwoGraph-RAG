import type { Extractor } from '../registry.js';
import { classesExtractor } from './classes.js';
import { modulesExtractor } from './modules.js';
import { symbolsExtractor } from './symbols.js';
import { typesExtractor } from './types.js';

export { buildSymbol, isExported, symbolsExtractor } from './symbols.js';
export { classesExtractor } from './classes.js';
export { typesExtractor } from './types.js';
export { classifySource, modulesExtractor } from './modules.js';

/** The standard extractor set; grows as extractor issues land. */
export function defaultExtractors(): Extractor[] {
  return [symbolsExtractor, classesExtractor, typesExtractor, modulesExtractor];
}
