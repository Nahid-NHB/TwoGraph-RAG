import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  EditError,
  toTwoGraphError,
  TwoGraphError,
  ValidationError,
} from '@twograph/core';

describe('error hierarchy', () => {
  it('carries machine-readable codes and names', () => {
    const err = new ConfigError('missing key llm.provider', { details: { key: 'llm.provider' } });
    expect(err.code).toBe('CONFIG_INVALID');
    expect(err.name).toBe('ConfigError');
    expect(err.details).toEqual({ key: 'llm.provider' });
    expect(err).toBeInstanceOf(TwoGraphError);
    expect(err).toBeInstanceOf(Error);
  });

  it('parameterized codes are constrained', () => {
    expect(new EditError('EDIT_STALE', 'file changed').code).toBe('EDIT_STALE');
  });

  it('preserves cause chains', () => {
    const cause = new Error('boom');
    const err = new ValidationError('bad input', { cause });
    expect(err.cause).toBe(cause);
  });

  it('toTwoGraphError wraps unknown values', () => {
    expect(toTwoGraphError('oops').code).toBe('INTERNAL');
    const original = new ConfigError('x');
    expect(toTwoGraphError(original)).toBe(original);
  });
});
