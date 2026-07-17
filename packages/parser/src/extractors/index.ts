import type { Extractor } from '../registry.js';
import { symbolsExtractor } from './symbols.js';

export { buildSymbol, isExported, symbolsExtractor } from './symbols.js';

/** The standard extractor set; grows as extractor issues land. */
export function defaultExtractors(): Extractor[] {
  return [symbolsExtractor];
}
