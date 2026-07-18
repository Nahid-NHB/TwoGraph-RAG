import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserEngine } from '@twograph/parser';
import { chunkFile } from '@twograph/vector';

const engine = new ParserEngine();
const SRC = join(import.meta.dirname, '../../../examples/sample-repo/src');

describe('chunkFile', () => {
  it('produces one enriched chunk per small symbol', async () => {
    const source = readFileSync(join(SRC, 'auth/jwt.ts'), 'utf8');
    const parsed = await engine.parseFile('r', 'auth/jwt.ts', source);
    const chunks = chunkFile(parsed, source);

    expect(chunks.length).toBe(parsed.symbols.length);
    const verify = chunks.find((c) => c.symbolId === 'r:auth/jwt.ts#verifyToken');
    expect(verify?.id).toBe('r:auth/jwt.ts#verifyToken');
    expect(verify?.content).toContain('// auth/jwt.ts · function verifyToken');
    expect(verify?.content).toContain('Verifies a JWT-shaped token');
    expect(verify?.content).toContain('export function verifyToken');
  });

  it('splits oversized symbols with overlap and part-suffixed ids', async () => {
    const bigBody = Array.from(
      { length: 320 },
      (_, i) => `  const line${String(i)} = ${String(i)};`,
    );
    const source = ['export function huge() {', ...bigBody, '}'].join('\n');
    const parsed = await engine.parseFile('r', 'big.ts', source);
    const chunks = chunkFile(parsed, source);

    const parts = chunks.filter((c) => c.symbolId === 'r:big.ts#huge');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]?.id).toBe('r:big.ts#huge~0');
    expect(parts[1]?.id).toBe('r:big.ts#huge~1');
    // Overlap: the tail lines of part 0 reappear at the head of part 1.
    const tail = parts[0]!.content.split('\n').slice(-3).join('\n');
    expect(parts[1]!.content).toContain(tail.split('\n')[0]);
  });

  it('content hashes are stable across identical re-parses', async () => {
    const source = readFileSync(join(SRC, 'components/UserCard.tsx'), 'utf8');
    const a = chunkFile(await engine.parseFile('r', 'components/UserCard.tsx', source), source);
    const b = chunkFile(await engine.parseFile('r', 'components/UserCard.tsx', source), source);
    expect(a.map((c) => c.contentHash)).toEqual(b.map((c) => c.contentHash));
  });

  it('hash changes when a symbol body changes', async () => {
    const v1 = 'export function f() { return 1; }';
    const v2 = 'export function f() { return 2; }';
    const c1 = chunkFile(await engine.parseFile('r', 'a.ts', v1), v1);
    const c2 = chunkFile(await engine.parseFile('r', 'a.ts', v2), v2);
    expect(c1[0]?.contentHash).not.toBe(c2[0]?.contentHash);
  });
});
