import { createLogger } from '@twograph/core';
import type { GraphClient } from './client.js';

const log = createLogger('graph:schema');

/** All node labels of the knowledge graph (docs/05-graph-schema.md §1). */
export const NODE_LABELS = [
  'Repository',
  'Package',
  'Directory',
  'File',
  'Class',
  'Function',
  'Method',
  'Hook',
  'Component',
  'Interface',
  'Enum',
  'TypeAlias',
  'Variable',
  'Import',
  'Export',
  'Route',
  'Api',
  'Context',
  'Dependency',
  'Test',
  'Configuration',
] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

/** Labels that get a secondary index on `name` (hot lookup paths). */
const NAME_INDEXED: NodeLabel[] = [
  'File',
  'Class',
  'Function',
  'Method',
  'Hook',
  'Component',
  'Interface',
  'Variable',
  'Context',
  'Dependency',
  'Route',
];

/** Statements the bootstrap applies; exported for unit tests. */
export function schemaStatements(): string[] {
  const statements: string[] = [];
  for (const label of NODE_LABELS) {
    statements.push(`CREATE CONSTRAINT ON (n:${label}) ASSERT n.id IS UNIQUE`);
    statements.push(`CREATE INDEX ON :${label}(repoId)`);
  }
  for (const label of NAME_INDEXED) {
    statements.push(`CREATE INDEX ON :${label}(name)`);
  }
  statements.push('CREATE INDEX ON :Route(routePattern)');
  return statements;
}

/**
 * Applies constraints and indexes. Safe to run on every startup: statements
 * that already exist are ignored.
 */
export async function bootstrapSchema(client: GraphClient): Promise<void> {
  for (const statement of schemaStatements()) {
    try {
      await client.run(statement);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.cause instanceof Error
            ? err.cause.message
            : err.message
          : String(err);
      if (/already exists|constraint.*exists|index.*exists/i.test(message)) continue;
      throw err;
    }
  }
  log.debug('graph schema bootstrapped');
}
