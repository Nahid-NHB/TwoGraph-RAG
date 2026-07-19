import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EditOperationRegistry, type EditOperation } from '@twograph/editing';

function fakeOperation(id: string): EditOperation<{ symbolId: string }> {
  return {
    id,
    paramsSchema: z.object({ symbolId: z.string() }),
    entryPaths: () => [],
    plan: () => ({ affectedSymbols: [] }),
  };
}

describe('EditOperationRegistry', () => {
  it('registers and retrieves an operation by id', () => {
    const registry = new EditOperationRegistry();
    const operation = fakeOperation('rename_symbol');
    registry.register(operation);
    expect(registry.get('rename_symbol')).toBe(operation);
  });

  it('rejects registering the same id twice', () => {
    const registry = new EditOperationRegistry();
    registry.register(fakeOperation('rename_symbol'));
    expect(() => registry.register(fakeOperation('rename_symbol'))).toThrow(/already registered/);
  });

  it('rejects looking up an unknown operation', () => {
    const registry = new EditOperationRegistry();
    expect(() => registry.get('does_not_exist')).toThrow(/unknown edit operation/);
  });

  it('lists every registered operation', () => {
    const registry = new EditOperationRegistry();
    registry.register(fakeOperation('rename_symbol'));
    registry.register(fakeOperation('move_function'));
    expect(
      registry
        .list()
        .map((op) => op.id)
        .sort(),
    ).toEqual(['move_function', 'rename_symbol']);
  });
});
