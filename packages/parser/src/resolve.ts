import { formatSymbolId, type ParsedFile } from '@twograph/core';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export interface ResolveOptions {
  /** tsconfig-style path aliases, e.g. { "@/*": ["src/*"] } (repo-relative targets). */
  paths?: Record<string, string[]>;
}

export interface ResolutionStats {
  resolved: number;
  unresolvedInternal: number;
  external: number;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Resolves cross-file references over a set of ParsedFiles (issue #21):
 * import bindings → target files (following re-export chains and barrels,
 * honoring tsconfig path aliases) → target symbols. Sets `resolvedId` on
 * reference records in place; file-local names resolve first.
 */
export function resolveReferences(
  files: ParsedFile[],
  options: ResolveOptions = {},
): ResolutionStats {
  const byPath = new Map<string, ParsedFile>();
  for (const file of files) byPath.set(file.path, file);

  /** Resolve a module specifier from an importing file to a ParsedFile path. */
  const resolveModule = (fromPath: string, specifier: string): string | undefined => {
    let candidateBase: string | undefined;
    if (specifier.startsWith('.')) {
      candidateBase = normalize(`${dirname(fromPath)}/${specifier}`);
    } else if (options.paths) {
      for (const [pattern, targets] of Object.entries(options.paths)) {
        const prefix = pattern.replace(/\*$/, '');
        if (!specifier.startsWith(prefix)) continue;
        const rest = specifier.slice(prefix.length);
        for (const target of targets) {
          const base = normalize(target.replace(/\*$/, '') + rest);
          const hit = tryFiles(base);
          if (hit) return hit;
        }
      }
      return undefined;
    } else {
      return undefined;
    }
    return tryFiles(candidateBase);
  };

  const tryFiles = (base: string): string | undefined => {
    if (byPath.has(base)) return base;
    for (const ext of EXTENSIONS) {
      if (byPath.has(base + ext)) return base + ext;
    }
    for (const ext of EXTENSIONS) {
      const index = `${base}/index${ext}`;
      if (byPath.has(index)) return index;
    }
    return undefined;
  };

  /** Find the symbol id exporting `name` from `path`, following re-export chains. */
  const resolveExport = (
    path: string,
    name: string,
    seen = new Set<string>(),
  ): string | undefined => {
    const key = `${path}|${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const file = byPath.get(path);
    if (!file) return undefined;

    for (const exp of file.exports) {
      if (exp.kind === 'star') continue;
      if (exp.name !== name) continue;
      if (exp.kind === 'reExport' && exp.source) {
        const target = resolveModule(path, exp.source);
        return target ? resolveExport(target, exp.local ?? name, seen) : undefined;
      }
      const local = exp.local ?? name;
      const symbol = file.symbols.find((s) => s.qualifiedName === local || s.name === local);
      if (symbol) return symbol.id;
      // Exported binding without an extracted symbol (e.g. destructured) — synthesize.
      return formatSymbolId({ repo: file.repo, path, qualifiedName: local });
    }

    // Fall back to star re-exports.
    for (const exp of file.exports) {
      if (exp.kind !== 'star' || !exp.source) continue;
      const target = resolveModule(path, exp.source);
      if (!target) continue;
      const hit = resolveExport(target, name, seen);
      if (hit) return hit;
    }
    return undefined;
  };

  const stats: ResolutionStats = { resolved: 0, unresolvedInternal: 0, external: 0 };

  for (const file of files) {
    const bindings = new Map<string, { source: string; imported: string }>();
    for (const imp of file.imports) {
      for (const spec of imp.specifiers) {
        bindings.set(spec.local, { source: imp.source, imported: spec.imported });
      }
    }
    const localByQualified = new Map(file.symbols.map((s) => [s.qualifiedName, s]));

    for (const ref of file.references) {
      if (ref.resolvedId) continue;
      const segments = ref.name.split('.');
      let base = segments[0] ?? ref.name;

      // `this.method` → resolve against the enclosing class.
      if (base === 'this' && ref.from?.includes('.')) {
        const classPrefix = ref.from.slice(0, ref.from.lastIndexOf('.'));
        const target = localByQualified.get(`${classPrefix}.${segments[1] ?? ''}`);
        if (target) {
          ref.resolvedId = target.id;
          stats.resolved += 1;
        }
        continue;
      }

      // 1) Scope-qualified local resolution: walk enclosing scopes outward.
      let localHit = localByQualified.get(ref.name);
      if (!localHit && ref.from) {
        const scopeParts = ref.from.split('.');
        for (let i = scopeParts.length; i > 0 && !localHit; i--) {
          localHit = localByQualified.get([...scopeParts.slice(0, i), base].join('.'));
        }
      }
      localHit ??= localByQualified.get(base);
      if (localHit && !bindings.has(base)) {
        ref.resolvedId = localHit.id;
        stats.resolved += 1;
        continue;
      }

      // 2) Import-based resolution.
      const binding = bindings.get(base);
      if (!binding) continue;
      const targetPath = resolveModule(file.path, binding.source);
      if (!targetPath) {
        stats.external += 1; // package or unindexed module — Dependency edge via imports
        continue;
      }
      let exportedName: string;
      if (binding.imported === '*') {
        base = segments[1] ?? 'default';
        exportedName = base;
      } else {
        exportedName = binding.imported;
      }
      const resolvedId = resolveExport(targetPath, exportedName);
      if (resolvedId) {
        ref.resolvedId = resolvedId;
        stats.resolved += 1;
      } else {
        stats.unresolvedInternal += 1;
      }
    }
  }
  return stats;
}
