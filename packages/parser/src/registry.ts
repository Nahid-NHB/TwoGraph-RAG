import { createRequire } from 'node:module';
import { join, dirname, extname } from 'node:path';
import type { Language as CoreLanguage, ParsedFile } from '@twograph/core';
import type { Tree } from 'web-tree-sitter';

/**
 * A language plugin maps file extensions to a Tree-sitter grammar and the
 * extractors that turn its syntax tree into domain records (docs/09 §1).
 */
export interface LanguagePlugin {
  /** Grammar id — also the wasm file discriminator, e.g. `typescript`. */
  readonly id: string;
  readonly extensions: readonly string[];
  /** Core language tag recorded on ParsedFile, keyed by extension. */
  readonly languageFor: (extension: string) => CoreLanguage;
  /** Absolute path to the grammar wasm. */
  readonly wasmPath: string;
  readonly extractors: readonly Extractor[];
}

/** Mutable accumulator extractors write into; becomes the ParsedFile. */
export type ExtractionSink = Pick<ParsedFile, 'symbols' | 'imports' | 'exports' | 'references'>;

export interface ExtractionContext {
  readonly repo: string;
  readonly path: string;
  readonly language: CoreLanguage;
  readonly source: string;
  readonly tree: Tree;
  readonly sink: ExtractionSink;
}

export interface Extractor {
  readonly id: string;
  extract(ctx: ExtractionContext): void;
}

const require = createRequire(import.meta.url);

/** Resolves a prebuilt grammar wasm shipped by tree-sitter-wasms. */
export function grammarWasmPath(grammarId: string): string {
  const pkg = require.resolve('tree-sitter-wasms/package.json');
  return join(dirname(pkg), 'out', `tree-sitter-${grammarId}.wasm`);
}

export class ParserRegistry {
  private readonly byExtension = new Map<string, LanguagePlugin>();
  private readonly plugins: LanguagePlugin[] = [];

  register(plugin: LanguagePlugin): this {
    this.plugins.push(plugin);
    for (const ext of plugin.extensions) this.byExtension.set(ext, plugin);
    return this;
  }

  /** Resolve the plugin handling a file path, by extension. */
  resolve(path: string): LanguagePlugin | undefined {
    return this.byExtension.get(extname(path).toLowerCase());
  }

  supportedExtensions(): string[] {
    return [...this.byExtension.keys()];
  }

  all(): readonly LanguagePlugin[] {
    return this.plugins;
  }
}

/**
 * Default registry: JavaScript (also covers JSX — the JS grammar includes it),
 * TypeScript, and TSX. Extractors are registered per grammar as they land.
 */
export function defaultRegistry(extractors: readonly Extractor[] = []): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register({
    id: 'javascript',
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
    languageFor: (ext) => (ext === '.jsx' ? 'jsx' : 'javascript'),
    wasmPath: grammarWasmPath('javascript'),
    extractors,
  });
  registry.register({
    id: 'typescript',
    extensions: ['.ts', '.mts', '.cts'],
    languageFor: () => 'typescript',
    wasmPath: grammarWasmPath('typescript'),
    extractors,
  });
  registry.register({
    id: 'tsx',
    extensions: ['.tsx'],
    languageFor: () => 'tsx',
    wasmPath: grammarWasmPath('tsx'),
    extractors,
  });
  return registry;
}
