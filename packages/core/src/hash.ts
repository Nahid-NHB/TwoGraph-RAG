import { createHash } from 'node:crypto';

/**
 * Content hash used for incremental indexing (files, symbols, chunks).
 * SHA-256 truncated to 16 hex chars — collision-safe at repo scale and compact
 * enough to store everywhere.
 */
export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
