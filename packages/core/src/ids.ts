import { InvalidIdError } from './errors.js';

/**
 * Stable symbol IDs are the universal join key across the knowledge graph,
 * vector store, and metadata store (docs/02-architecture.md ADR-6).
 *
 * Format: `repo:relPath#qualifiedName` — e.g. `myapp:src/auth/jwt.ts#verifyToken`
 * File IDs: `repo:relPath`.
 * Chunk IDs: `symbolId` or `symbolId~partN` for split symbols.
 */

/** Repo slugs: url-safe, no separators used by the codec. */
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface SymbolIdParts {
  readonly repo: string;
  /** Repo-relative POSIX path, e.g. `src/auth/jwt.ts`. */
  readonly path: string;
  /** Dot-qualified name within the file, e.g. `AuthService.login`. */
  readonly qualifiedName: string;
}

export interface FileIdParts {
  readonly repo: string;
  readonly path: string;
}

function assertRepo(repo: string): void {
  if (!REPO_RE.test(repo)) {
    throw new InvalidIdError(`invalid repo slug: ${JSON.stringify(repo)}`);
  }
}

function assertPath(path: string): void {
  if (
    path.length === 0 ||
    path.includes('#') ||
    path.includes(':') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.includes('~')
  ) {
    throw new InvalidIdError(
      `invalid path (must be repo-relative POSIX, no ":", "#", "~"): ${JSON.stringify(path)}`,
    );
  }
}

function assertQualifiedName(name: string): void {
  if (name.length === 0 || name.includes('#') || name.includes(':') || name.includes('~')) {
    throw new InvalidIdError(`invalid qualified name: ${JSON.stringify(name)}`);
  }
}

export function formatFileId(parts: FileIdParts): string {
  assertRepo(parts.repo);
  assertPath(parts.path);
  return `${parts.repo}:${parts.path}`;
}

export function parseFileId(id: string): FileIdParts {
  const sep = id.indexOf(':');
  if (sep === -1 || id.includes('#')) {
    throw new InvalidIdError(`not a file id: ${JSON.stringify(id)}`);
  }
  const repo = id.slice(0, sep);
  const path = id.slice(sep + 1);
  assertRepo(repo);
  assertPath(path);
  return { repo, path };
}

export function formatSymbolId(parts: SymbolIdParts): string {
  assertRepo(parts.repo);
  assertPath(parts.path);
  assertQualifiedName(parts.qualifiedName);
  return `${parts.repo}:${parts.path}#${parts.qualifiedName}`;
}

export function parseSymbolId(id: string): SymbolIdParts {
  const hash = id.indexOf('#');
  if (hash === -1) throw new InvalidIdError(`not a symbol id (missing "#"): ${JSON.stringify(id)}`);
  const { repo, path } = parseFileId(id.slice(0, hash));
  const qualifiedName = id.slice(hash + 1);
  assertQualifiedName(qualifiedName);
  return { repo, path, qualifiedName };
}

export function isSymbolId(id: string): boolean {
  try {
    parseSymbolId(id);
    return true;
  } catch {
    return false;
  }
}

/** Chunk IDs append `~partN` when a symbol is split into multiple chunks. */
export function formatChunkId(symbolId: string, part?: number): string {
  parseSymbolId(symbolId);
  if (part === undefined) return symbolId;
  if (!Number.isInteger(part) || part < 0) {
    throw new InvalidIdError(`invalid chunk part: ${String(part)}`);
  }
  return `${symbolId}~${String(part)}`;
}

export function parseChunkId(id: string): { symbolId: string; part?: number } {
  const tilde = id.lastIndexOf('~');
  if (tilde === -1) {
    parseSymbolId(id);
    return { symbolId: id };
  }
  const symbolId = id.slice(0, tilde);
  const part = Number(id.slice(tilde + 1));
  parseSymbolId(symbolId);
  if (!Number.isInteger(part) || part < 0) {
    throw new InvalidIdError(`invalid chunk id: ${JSON.stringify(id)}`);
  }
  return { symbolId, part };
}
