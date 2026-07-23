import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoContext } from '../context.js';

/** Common entry-file basenames used as a fallback when `index.entryPoints` isn't configured. */
const ENTRY_CANDIDATES = [
  'src/main.ts',
  'src/main.tsx',
  'src/index.ts',
  'src/index.tsx',
  'src/App.tsx',
  'index.ts',
  'index.js',
];

interface FileRow {
  rel_path: string;
  language: string;
}

interface KindCountRow {
  kind: string;
  count: number;
}

interface KeyModuleRow {
  relPath: string;
  count: number;
}

export interface RepositorySummary {
  repo: string;
  fileCount: number;
  languages: Record<string, number>;
  symbolCounts: Record<string, number>;
  stacks: string[];
  entryPoints: string[];
  keyModules: { path: string; exportedSymbols: number }[];
}

function readStacks(rootPath: string): string[] {
  try {
    const raw = readFileSync(join(rootPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort();
  } catch {
    return [];
  }
}

/** Aggregates file/symbol counts, stacks, entry points, and key modules for a repo overview. */
export function buildRepositorySummary(ctx: RepoContext): RepositorySummary {
  const files = ctx.store.db
    .prepare('SELECT rel_path, language FROM files WHERE repo_id = ?')
    .all(ctx.repo.id) as unknown as FileRow[];

  const languages: Record<string, number> = {};
  for (const file of files) {
    languages[file.language] = (languages[file.language] ?? 0) + 1;
  }

  const kindRows = ctx.store.db
    .prepare('SELECT kind, COUNT(*) as count FROM symbols WHERE repo_id = ? GROUP BY kind')
    .all(ctx.repo.id) as unknown as KindCountRow[];

  const keyModuleRows = ctx.store.db
    .prepare(
      `SELECT f.rel_path as relPath, COUNT(*) as count
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE s.repo_id = ? AND s.exported = 1
       GROUP BY f.rel_path
       ORDER BY count DESC
       LIMIT 10`,
    )
    .all(ctx.repo.id) as unknown as KeyModuleRow[];

  const relPaths = new Set(files.map((f) => f.rel_path));
  const configuredEntries = ctx.config.index.entryPoints.filter((p) => relPaths.has(p));
  const entryPoints =
    configuredEntries.length > 0
      ? configuredEntries
      : ENTRY_CANDIDATES.filter((p) => relPaths.has(p));

  return {
    repo: ctx.repo.name,
    fileCount: files.length,
    languages,
    symbolCounts: Object.fromEntries(kindRows.map((r) => [r.kind, r.count])),
    stacks: readStacks(ctx.repo.rootPath),
    entryPoints,
    keyModules: keyModuleRows.map((r) => ({ path: r.relPath, exportedSymbols: r.count })),
  };
}
