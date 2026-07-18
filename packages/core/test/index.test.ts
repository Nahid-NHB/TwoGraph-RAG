import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '@twograph/core';

describe('@twograph/core', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@twograph/core');
  });
});
