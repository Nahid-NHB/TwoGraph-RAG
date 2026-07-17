import type { Extractor } from '../registry.js';
import { classesExtractor } from './classes.js';
import { symbolsExtractor } from './symbols.js';

export { buildSymbol, isExported, symbolsExtractor } from './symbols.js';
export { classesExtractor } from './classes.js';

/** The standard extractor set; grows as extractor issues land. */
export function defaultExtractors(): Extractor[] {
  return [symbolsExtractor, classesExtractor];
}
