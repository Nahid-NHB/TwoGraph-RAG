import { z } from 'zod';

/** Languages the parser understands; `other` files are indexed as blobs only. */
export const languageSchema = z.enum(['javascript', 'typescript', 'jsx', 'tsx', 'json', 'other']);
export type Language = z.infer<typeof languageSchema>;

/** Kinds of code symbols extracted by the parser (graph node labels derive from these). */
export const symbolKindSchema = z.enum([
  'function',
  'class',
  'method',
  'hook',
  'component',
  'interface',
  'enum',
  'typeAlias',
  'variable',
  'route',
  'api',
  'context',
  'test',
]);
export type SymbolKind = z.infer<typeof symbolKindSchema>;

/** Edge types of the knowledge graph (docs/05-graph-schema.md §2). */
export const edgeKindSchema = z.enum([
  'CONTAINS',
  'IMPORTS',
  'EXPORTS',
  'CALLS',
  'USES',
  'DEFINES',
  'DECLARES',
  'IMPLEMENTS',
  'EXTENDS',
  'RETURNS',
  'READS',
  'WRITES',
  'DEPENDS_ON',
  'TESTS',
  'REFERENCES',
  'USES_COMPONENT',
  'USES_HOOK',
  'PROVIDES_CONTEXT',
  'CONSUMES_CONTEXT',
  'HANDLES',
]);
export type EdgeKind = z.infer<typeof edgeKindSchema>;

export const spanSchema = z.object({
  /** 1-based, inclusive. */
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
});
export type Span = z.infer<typeof spanSchema>;

/** Structured JSDoc/TSDoc attached to a symbol. */
export const docstringSchema = z.object({
  summary: z.string(),
  params: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
  returns: z.string().optional(),
  deprecated: z.string().optional(),
  raw: z.string(),
});
export type Docstring = z.infer<typeof docstringSchema>;

export const codeSymbolSchema = z.object({
  /** Stable symbol id — `repo:path#qualifiedName`. */
  id: z.string(),
  repo: z.string(),
  path: z.string(),
  kind: symbolKindSchema,
  name: z.string(),
  /** Dot-qualified within the file, e.g. `AuthService.login`. */
  qualifiedName: z.string(),
  span: spanSchema,
  signature: z.string().optional(),
  doc: docstringSchema.optional(),
  exported: z.boolean().default(false),
  /** xxhash64 of the symbol's source text; gates re-embedding. */
  contentHash: z.string(),
  /** Kind-specific extras (componentKind, propsType, builtin, routePattern, …). */
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type CodeSymbol = z.infer<typeof codeSymbolSchema>;

export const importRecordSchema = z.object({
  /** Module specifier as written, e.g. `./auth` or `axios`. */
  source: z.string(),
  sourceType: z.enum(['relative', 'package', 'builtin']),
  /** Import bindings: local name → imported name (`default`, `*`, or named). */
  specifiers: z.array(z.object({ local: z.string(), imported: z.string() })),
  kind: z.enum(['static', 'dynamic', 'require', 'sideEffect']),
  line: z.number().int().min(1),
});
export type ImportRecord = z.infer<typeof importRecordSchema>;

export const exportRecordSchema = z.object({
  /** Exported (public) name; `default` for default exports. */
  name: z.string(),
  /** Local symbol name backing the export, if any. */
  local: z.string().optional(),
  kind: z.enum(['named', 'default', 'reExport', 'star']),
  /** For re-exports: the source module specifier. */
  source: z.string().optional(),
  line: z.number().int().min(1),
});
export type ExportRecord = z.infer<typeof exportRecordSchema>;

/** A use of a name inside a symbol — raw material for CALLS/USES/READS/WRITES edges. */
export const referenceRecordSchema = z.object({
  /** Qualified name of the enclosing symbol; undefined = module top level. */
  from: z.string().optional(),
  /** Referenced name/chain as written, e.g. `fetchUser` or `api.client.get`. */
  name: z.string(),
  kind: z.enum(['call', 'read', 'write', 'type', 'jsx', 'hook', 'extends', 'implements']),
  line: z.number().int().min(1),
  /** Resolved stable symbol id (cross-file pass) — absent until resolution. */
  resolvedId: z.string().optional(),
  /** True when the name comes from an import binding. */
  imported: z.boolean().default(false),
});
export type ReferenceRecord = z.infer<typeof referenceRecordSchema>;

export const parsedFileSchema = z.object({
  repo: z.string(),
  path: z.string(),
  language: languageSchema,
  contentHash: z.string(),
  symbols: z.array(codeSymbolSchema),
  imports: z.array(importRecordSchema),
  exports: z.array(exportRecordSchema),
  references: z.array(referenceRecordSchema),
});
export type ParsedFile = z.infer<typeof parsedFileSchema>;

export const chunkSchema = z.object({
  /** `symbolId` or `symbolId~partN`. */
  id: z.string(),
  symbolId: z.string(),
  repo: z.string(),
  /** Enriched text: path + kind + signature + doc + body. */
  content: z.string(),
  contentHash: z.string(),
});
export type Chunk = z.infer<typeof chunkSchema>;

export const retrievalSourceSchema = z.enum(['bm25', 'vector', 'graph', 'expansion', 'fused']);
export type RetrievalSource = z.infer<typeof retrievalSourceSchema>;

export const rankedHitSchema = z.object({
  symbolId: z.string(),
  score: z.number(),
  source: retrievalSourceSchema,
  /** Human-readable graph path when the hit came via traversal. */
  graphPath: z.string().optional(),
  /** Per-source ranks kept through fusion for explainability. */
  provenance: z.record(z.string(), z.number()).default({}),
});
export type RankedHit = z.infer<typeof rankedHitSchema>;

export const citationSchema = z.object({
  file: z.string(),
  symbolId: z.string().optional(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  graphPath: z.string().optional(),
});
export type Citation = z.infer<typeof citationSchema>;
