import { describe, expect, it } from 'vitest';
import { LruCache } from '@twograph/core';

describe('LruCache', () => {
  it('returns undefined for a missing key', () => {
    const cache = new LruCache<string, number>(2);
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry once full', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a' — least recently touched
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('get() refreshes recency, protecting a just-read entry from eviction', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' is now more recent than 'b'
    cache.set('c', 3); // evicts 'b', not 'a'
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('set() on an existing key updates the value and its recency', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // refreshes 'a'
    cache.set('c', 3); // evicts 'b', not 'a'
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBeUndefined();
  });

  it('delete() and clear() remove entries', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('rejects a non-positive-integer maxSize', () => {
    expect(() => new LruCache(0)).toThrow(RangeError);
    expect(() => new LruCache(-1)).toThrow(RangeError);
    expect(() => new LruCache(1.5)).toThrow(RangeError);
  });
});
