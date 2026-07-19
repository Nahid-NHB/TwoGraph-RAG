import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import picomatch from 'picomatch';

const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
];

export interface DiscoveredFile {
  relPath: string;
  size: number;
}

/** Walks a repo root collecting parseable files, honoring ignore globs. */
export function discoverFiles(
  rootPath: string,
  extensions: readonly string[],
  ignore: readonly string[] = [],
): DiscoveredFile[] {
  const isIgnored = picomatch([...DEFAULT_IGNORES, ...ignore], { dot: true });
  const extSet = new Set(extensions);
  const results: DiscoveredFile[] = [];

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const rel = relative(rootPath, full).replaceAll('\\', '/');
      if (isIgnored(rel) || isIgnored(`${rel}/`)) continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else {
        const dot = entry.lastIndexOf('.');
        if (dot !== -1 && extSet.has(entry.slice(dot).toLowerCase())) {
          results.push({ relPath: rel, size: stat.size });
        }
      }
    }
  };
  walk(rootPath);
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

export function readSource(rootPath: string, relPath: string): string {
  return readFileSync(join(rootPath, relPath), 'utf8');
}

export interface DiffResult {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
}

/** Compares discovered file hashes with the stored ones. */
export function diffFiles(
  discovered: Map<string, string>,
  stored: Map<string, string>,
): DiffResult {
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const [path, hash] of discovered) {
    const prior = stored.get(path);
    if (prior === undefined) added.push(path);
    else if (prior !== hash) changed.push(path);
    else unchanged.push(path);
  }
  const removed = [...stored.keys()].filter((p) => !discovered.has(p));
  return { added, changed, removed, unchanged };
}
