import { createLogger, hashContent, type ParsedFile } from '@twograph/core';
import { GraphWriter, type GraphClient } from '@twograph/graph';
import { createModuleResolver, ParserEngine, resolveReferences } from '@twograph/parser';
import type { FtsIndex, MetadataStore } from '@twograph/store';
import { chunkFile, type Embedder, type VectorStore } from '@twograph/vector';
import { discoverFiles, diffFiles, readSource } from './discover.js';

const log = createLogger('indexer');

export interface IndexerDeps {
  repo: { id: string; rootPath: string; name: string };
  graphClient: GraphClient;
  store: MetadataStore;
  fts: FtsIndex;
  vectors: VectorStore;
  embedder: Embedder;
  engine?: ParserEngine;
  ignore?: string[];
  tsconfigPaths?: Record<string, string[]>;
}

export type IndexStage = 'discover' | 'parse' | 'graph' | 'chunks' | 'embed' | 'done';

export interface IndexProgress {
  stage: IndexStage;
  current: number;
  total: number;
}

export interface IndexRunResult {
  runId: string;
  added: number;
  changed: number;
  removed: number;
  embedded: number;
  errors: { path: string; message: string }[];
  durationMs: number;
}

const PARSE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

/**
 * End-to-end indexing pipeline (issue #34):
 * discover → hash-diff → parse → graph write (incremental) → chunk → embed.
 * Per-file errors are isolated; failed files keep their old hash so the next
 * run retries them. Unchanged chunks are never re-embedded.
 */
export class Indexer {
  private readonly engine: ParserEngine;
  private readonly writer: GraphWriter;

  constructor(
    private readonly deps: IndexerDeps,
    private readonly onProgress: (p: IndexProgress) => void = () => {},
  ) {
    this.engine = deps.engine ?? new ParserEngine();
    this.writer = new GraphWriter(deps.graphClient);
  }

  async run(options: { rebuild?: boolean } = {}): Promise<IndexRunResult> {
    const started = performance.now();
    const { repo, store, fts, vectors } = this.deps;
    const runId = store.startIndexRun(repo.id, options.rebuild ? 'full' : 'incremental');
    const errors: IndexRunResult['errors'] = [];

    try {
      store.upsertRepository({ id: repo.id, rootPath: repo.rootPath, name: repo.name });
      await this.writer.ensureRepository({ id: repo.id, name: repo.name, rootPath: repo.rootPath });
      await vectors.ensureCollection();

      if (options.rebuild) {
        await this.deps.graphClient.run('MATCH (n {repoId: $repo}) DETACH DELETE n', {
          repo: repo.id,
        });
        await this.writer.ensureRepository({
          id: repo.id,
          name: repo.name,
          rootPath: repo.rootPath,
        });
        fts.deleteByRepo(repo.id);
        await vectors.deleteByRepo(repo.id);
        store.db.prepare(`DELETE FROM files WHERE repo_id = ?`).run(repo.id);
      }

      // 1) discover + hash
      this.onProgress({ stage: 'discover', current: 0, total: 0 });
      const discovered = discoverFiles(repo.rootPath, PARSE_EXTENSIONS, this.deps.ignore ?? []);
      const sources = new Map<string, string>();
      const hashes = new Map<string, string>();
      for (const file of discovered) {
        try {
          const source = readSource(repo.rootPath, file.relPath);
          sources.set(file.relPath, source);
          hashes.set(file.relPath, hashContent(source));
        } catch (err) {
          errors.push({ path: file.relPath, message: String(err) });
        }
      }
      const diff = diffFiles(hashes, store.fileHashes(repo.id));
      const touched = [...diff.added, ...diff.changed];

      // 2) parse everything (fast) — resolution needs full export tables.
      const parsedFiles: ParsedFile[] = [];
      const parsedByPath = new Map<string, ParsedFile>();
      let parsedCount = 0;
      for (const [path, source] of sources) {
        try {
          const parsed = await this.engine.parseFile(repo.id, path, source);
          parsedFiles.push(parsed);
          parsedByPath.set(path, parsed);
        } catch (err) {
          errors.push({ path, message: String(err) });
          hashes.delete(path); // keep old hash → retried next run
        }
        this.onProgress({ stage: 'parse', current: ++parsedCount, total: sources.size });
      }
      const resolveOpts = this.deps.tsconfigPaths ? { paths: this.deps.tsconfigPaths } : {};
      resolveReferences(parsedFiles, resolveOpts);
      const resolver = createModuleResolver(
        parsedFiles.map((f) => f.path),
        resolveOpts,
      );

      // 3) nodes-only pass for every touched file first — guarantees every
      // symbol node exists before any edge pass runs. Writing nodes and edges
      // file-by-file silently dropped CALLS/USES/etc. edges whenever the
      // callee lived in a file that sorts alphabetically after the caller,
      // since the MATCH on the not-yet-created target node found nothing.
      const nodesWritten: string[] = [];
      for (const path of touched) {
        const parsed = parsedByPath.get(path);
        if (!parsed) continue;
        try {
          if (diff.changed.includes(path)) {
            await this.writer.removeFileSubgraph(repo.id, path);
          }
          await this.writer.writeParsedFile(parsed);
          nodesWritten.push(path);
        } catch (err) {
          errors.push({ path, message: String(err) });
          hashes.delete(path);
          log.warn({ path, err: String(err) }, 'file indexing failed; will retry next run');
        }
      }

      // 4) edges + store + chunks + embeddings per touched file
      let graphCount = 0;
      const toEmbed: {
        chunkId: string;
        symbolId: string;
        content: string;
        meta: { kind: string; path: string; language: string; name: string; exported: boolean };
      }[] = [];

      for (const path of nodesWritten) {
        const parsed = parsedByPath.get(path);
        if (!parsed) continue;
        try {
          const fileId = `${repo.id}:${path}`;
          const oldSymbolIds = store.symbolsByFile(fileId).map((s) => s.id);

          await this.writer.writeStructuralEdges(parsed, resolver);
          await this.writer.writeBehavioralEdges(parsed);
          await this.writer.writeReactEdges(parsed);

          if (diff.changed.includes(path)) {
            const dependentPaths = await this.writer.dependentFiles(repo.id, path);
            for (const depPath of dependentPaths) {
              const dep = parsedByPath.get(depPath);
              if (!dep) continue;
              await this.writer.writeStructuralEdges(dep, resolver);
              await this.writer.writeBehavioralEdges(dep);
              await this.writer.writeReactEdges(dep);
            }
          }

          // Metadata + chunk sync with embedding gate.
          const chunkStates = store.chunkStates(oldSymbolIds);
          store.replaceFile(parsed, sources.get(path)?.length ?? 0);
          const chunks = chunkFile(parsed, sources.get(path) ?? '');
          store.insertChunks(chunks, chunkStates);

          const symbolByQualified = new Map(parsed.symbols.map((s) => [s.id, s]));
          fts.deleteByPath(repo.id, path);
          fts.upsert(
            chunks.map((c) => {
              const symbol = symbolByQualified.get(c.symbolId);
              return {
                chunkId: c.id,
                repo: repo.id,
                content: c.content,
                name: symbol?.name ?? c.symbolId,
                path,
                kind: symbol?.kind ?? 'function',
              };
            }),
          );

          const newSymbolIds = new Set(parsed.symbols.map((s) => s.id));
          const goneSymbols = oldSymbolIds.filter((id) => !newSymbolIds.has(id));
          if (goneSymbols.length > 0) await vectors.deleteBySymbolIds(repo.id, goneSymbols);

          for (const chunk of chunks) {
            const prior = chunkStates.get(chunk.id);
            if (prior && prior.hash === chunk.contentHash && prior.embeddedAt) continue;
            const symbol = symbolByQualified.get(chunk.symbolId);
            toEmbed.push({
              chunkId: chunk.id,
              symbolId: chunk.symbolId,
              content: chunk.content,
              meta: {
                kind: symbol?.kind ?? 'function',
                path,
                language: parsed.language,
                name: symbol?.name ?? chunk.symbolId,
                exported: symbol?.exported ?? false,
              },
            });
          }
        } catch (err) {
          errors.push({ path, message: String(err) });
          hashes.delete(path);
          log.warn({ path, err: String(err) }, 'file indexing failed; will retry next run');
        }
        this.onProgress({ stage: 'graph', current: ++graphCount, total: nodesWritten.length });
      }

      // 5) removed files: purge everywhere.
      for (const path of diff.removed) {
        const fileId = `${repo.id}:${path}`;
        const symbolIds = store.symbolsByFile(fileId).map((s) => s.id);
        await this.writer.removeFileSubgraph(repo.id, path, { deleteFile: true });
        if (symbolIds.length > 0) await vectors.deleteBySymbolIds(repo.id, symbolIds);
        fts.deleteByPath(repo.id, path);
        store.deleteFile(repo.id, path);
      }

      // 6) embed pending chunks in batches.
      let embedded = 0;
      this.onProgress({ stage: 'embed', current: 0, total: toEmbed.length });
      const BATCH = 32;
      for (let i = 0; i < toEmbed.length; i += BATCH) {
        const batch = toEmbed.slice(i, i + BATCH);
        const vectorsOut = await this.deps.embedder.embed(batch.map((b) => b.content));
        await vectors.upsert(
          batch.map((b, j) => ({
            chunkId: b.chunkId,
            symbolId: b.symbolId,
            repo: repo.id,
            vector: vectorsOut[j] ?? new Float32Array(this.deps.embedder.dimensions),
            payload: b.meta,
          })),
        );
        store.markChunksEmbedded(batch.map((b) => b.chunkId));
        embedded += batch.length;
        this.onProgress({ stage: 'embed', current: embedded, total: toEmbed.length });
      }

      store.touchRepository(repo.id);
      const stats = {
        added: diff.added.length,
        changed: diff.changed.length,
        removed: diff.removed.length,
      };
      store.finishIndexRun(
        runId,
        stats,
        errors.length > 0 ? `${String(errors.length)} file(s) failed` : undefined,
      );
      this.onProgress({ stage: 'done', current: 1, total: 1 });
      return { runId, ...stats, embedded, errors, durationMs: performance.now() - started };
    } catch (err) {
      store.finishIndexRun(runId, { added: 0, changed: 0, removed: 0 }, String(err));
      throw err;
    }
  }
}
