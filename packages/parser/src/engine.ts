import { extname } from 'node:path';
import { hashContent, ParseError, type ParsedFile } from '@twograph/core';
import { Language, Parser, type Tree } from 'web-tree-sitter';
import { defaultRegistry, type LanguagePlugin, type ParserRegistry } from './registry.js';

let runtimeReady: Promise<void> | undefined;

async function ensureRuntime(): Promise<void> {
  runtimeReady ??= Parser.init();
  await runtimeReady;
}

/**
 * Parses files into Tree-sitter trees and runs the registered extractors.
 * Grammars are loaded lazily and cached; one Parser instance per grammar.
 */
export class ParserEngine {
  private readonly registry: ParserRegistry;
  private readonly languages = new Map<string, Language>();
  private readonly parsers = new Map<string, Parser>();

  constructor(registry: ParserRegistry = defaultRegistry()) {
    this.registry = registry;
  }

  pluginFor(path: string): LanguagePlugin | undefined {
    return this.registry.resolve(path);
  }

  /** Parse source into a tree. Error-tolerant: syntax errors yield ERROR nodes, not throws. */
  async parse(path: string, source: string): Promise<{ tree: Tree; plugin: LanguagePlugin }> {
    const plugin = this.registry.resolve(path);
    if (!plugin) {
      throw new ParseError(`no language plugin for ${path}`, { details: { path } });
    }
    const parser = await this.parserFor(plugin);
    const tree = parser.parse(source);
    if (!tree) {
      throw new ParseError(`tree-sitter returned no tree for ${path}`, { details: { path } });
    }
    return { tree, plugin };
  }

  /** Full pipeline for one file: parse + run extractors → ParsedFile. */
  async parseFile(repo: string, path: string, source: string): Promise<ParsedFile> {
    const { tree, plugin } = await this.parse(path, source);
    const language = plugin.languageFor(extname(path).toLowerCase());
    const sink: Pick<ParsedFile, 'symbols' | 'imports' | 'exports' | 'references'> = {
      symbols: [],
      imports: [],
      exports: [],
      references: [],
    };
    try {
      for (const extractor of plugin.extractors) {
        extractor.extract({ repo, path, language, source, tree, sink });
      }
    } finally {
      tree.delete();
    }
    return {
      repo,
      path,
      language,
      contentHash: hashContent(source),
      ...sink,
    };
  }

  /** Loaded grammar for a plugin (exposed for query helpers/tests). */
  async languageFor(plugin: LanguagePlugin): Promise<Language> {
    await ensureRuntime();
    let language = this.languages.get(plugin.id);
    if (!language) {
      language = await Language.load(plugin.wasmPath);
      this.languages.set(plugin.id, language);
    }
    return language;
  }

  private async parserFor(plugin: LanguagePlugin): Promise<Parser> {
    let parser = this.parsers.get(plugin.id);
    if (!parser) {
      const language = await this.languageFor(plugin);
      parser = new Parser();
      parser.setLanguage(language);
      this.parsers.set(plugin.id, parser);
    }
    return parser;
  }
}
