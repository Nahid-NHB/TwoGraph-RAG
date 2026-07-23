/**
 * Minimal in-memory LRU cache (issue #71): fixed capacity, evicts the least
 * recently used entry once full. `get` refreshes an entry's recency; a
 * successful `get`/`set` never throws — callers decide what "miss" means.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new RangeError(`LruCache maxSize must be a positive integer, got ${String(maxSize)}`);
    }
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
