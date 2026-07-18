import { describe, expect, it } from 'vitest';
import { NODE_LABELS, schemaStatements } from '@twograph/graph';

describe('schema statements', () => {
  it('creates a uniqueness constraint and repoId index for every label', () => {
    const statements = schemaStatements();
    for (const label of NODE_LABELS) {
      expect(statements).toContain(`CREATE CONSTRAINT ON (n:${label}) ASSERT n.id IS UNIQUE`);
      expect(statements).toContain(`CREATE INDEX ON :${label}(repoId)`);
    }
  });

  it('covers all documented labels (docs/05 §1)', () => {
    expect(NODE_LABELS).toHaveLength(21);
    expect(NODE_LABELS).toContain('Route');
    expect(NODE_LABELS).toContain('Configuration');
  });

  it('indexes route patterns for permanence lookups', () => {
    expect(schemaStatements()).toContain('CREATE INDEX ON :Route(routePattern)');
  });
});
