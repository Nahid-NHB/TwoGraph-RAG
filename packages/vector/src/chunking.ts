import { formatChunkId, hashContent, type Chunk, type ParsedFile } from '@twograph/core';

/** Symbols longer than this many lines are split into overlapping parts. */
const MAX_LINES = 120;
const OVERLAP_LINES = 10;

/**
 * Builds one enriched chunk per symbol (issue #32): a header carrying path,
 * kind, qualified name, signature, and docstring — so embeddings encode
 * context, not just the body — followed by the symbol source. Oversized
 * symbols split on line boundaries with overlap; parts share the symbol id
 * with a `~N` suffix.
 */
export function chunkFile(parsed: ParsedFile, source: string): Chunk[] {
  const lines = source.split('\n');
  const chunks: Chunk[] = [];

  for (const symbol of parsed.symbols) {
    const bodyLines = lines.slice(symbol.span.startLine - 1, symbol.span.endLine);
    const header = [
      `// ${parsed.path} · ${symbol.kind} ${symbol.qualifiedName}`,
      ...(symbol.signature ? [`// ${symbol.signature}`] : []),
      ...(symbol.doc?.summary ? [`// ${symbol.doc.summary.replaceAll('\n', ' ')}`] : []),
    ];

    if (bodyLines.length <= MAX_LINES) {
      const content = [...header, ...bodyLines].join('\n');
      chunks.push({
        id: formatChunkId(symbol.id),
        symbolId: symbol.id,
        repo: parsed.repo,
        content,
        contentHash: hashContent(content),
      });
      continue;
    }

    let part = 0;
    for (let start = 0; start < bodyLines.length; start += MAX_LINES - OVERLAP_LINES) {
      const slice = bodyLines.slice(start, start + MAX_LINES);
      const content = [...header, `// part ${String(part + 1)}`, ...slice].join('\n');
      chunks.push({
        id: formatChunkId(symbol.id, part),
        symbolId: symbol.id,
        repo: parsed.repo,
        content,
        contentHash: hashContent(content),
      });
      part += 1;
      if (start + MAX_LINES >= bodyLines.length) break;
    }
  }

  return chunks;
}
