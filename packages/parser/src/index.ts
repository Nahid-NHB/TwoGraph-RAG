export { ParserEngine } from './engine.js';
export {
  defaultRegistry,
  grammarWasmPath,
  ParserRegistry,
  type ExtractionContext,
  type ExtractionSink,
  type Extractor,
  type LanguagePlugin,
} from './registry.js';
export { captures, nodeSpan, text, type CaptureHit } from './query.js';
export {
  buildSymbol,
  defaultExtractors,
  isExported,
  symbolsExtractor,
} from './extractors/index.js';
